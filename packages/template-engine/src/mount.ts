import type { BlinkOnTake, Template } from "@overlaysys/core";
import { computeTimeDisplay } from "@overlaysys/core";
import gsap from "gsap";
import {
  buildTemplateDom,
  updateTemplateData,
  type LayerNodeMap,
} from "./dom";
import { ensureTemplateFonts } from "./fonts";
import { buildGsapTimeline } from "./gsap-timeline";

export type MountMode = "live" | "edit";

/**
 * Fallback OUT duration in seconds when a template doesn't define an OUT
 * timeline (or its tracks all target missing layers, so the built timeline
 * has zero duration). The renderer awaits playOut() before destroying the
 * mount, so without this fallback the previous template snaps off-screen
 * the instant the next take lands. 0.5s matches the song-session stage
 * fade — short enough to feel snappy, long enough to read as a transition.
 */
const DEFAULT_OUT_DURATION_S = 0.5;

/**
 * Restart a paused timeline from t=0, but force GSAP to actually write the
 * from-values for any fromTo tweens with immediateRender:false.
 *
 * Why: buildGsapTimeline creates fromTo tweens with immediateRender:false so
 * the IN and OUT timelines (which both target the same DOM) don't fight at
 * construction time over which from-value gets written. The trade-off is
 * that GSAP's standard restart() doesn't actually write the from-value at
 * progress 0 — it animates from whatever the DOM currently has to the
 * to-value. For an OUT (opacity 1 → 0) that's fine because the DOM is
 * already at 1; for an IN (opacity 0 → 1) it animates 1 → 1 (no visible
 * change), which looks like an instant snap.
 *
 * Fix: seek to the end first (forces GSAP to init the tweens and record
 * the from-values), then to 0 (writes the from to the DOM), then play.
 * All three calls are synchronous so the user only sees the final state.
 */
/**
 * Animate the mount's root opacity from its current value to 0 over the
 * default OUT duration. Used when the template author hasn't defined an
 * OUT timeline — hotcards, ad-hoc graphics, anything with `out: { duration: 0, tracks: [] }`
 * — so the swap to the next take still reads as a transition rather than
 * a snap. The opacity tween is on the mount root rather than per-layer so
 * it composes cleanly on top of whatever pose the layers were in when the
 * OUT fired.
 */
function playDefaultOut(root: HTMLElement): Promise<void> {
  return new Promise<void>((resolve) => {
    gsap.to(root, {
      opacity: 0,
      duration: DEFAULT_OUT_DURATION_S,
      ease: "power2.out",
      onComplete: () => resolve(),
    });
  });
}

function playFromStart(tl: gsap.core.Timeline): Promise<void> {
  if ((globalThis as { __overlaysys_log?: boolean }).__overlaysys_log) {
    console.log("[overlaysys:engine] playFromStart", {
      duration: tl.duration(),
      progress: tl.progress(),
      paused: tl.paused(),
      childCount: tl.getChildren().length,
    });
  }
  return new Promise<void>((resolve) => {
    tl.eventCallback("onComplete", () => resolve());
    // suppressEvents=true on the seeks so onComplete doesn't fire during
    // the priming.
    tl.progress(1, true).progress(0, true).play();
  });
}

/**
 * Merge a template's declared field defaults under any operator-supplied data.
 * Without this step the runtime would only have the explicit data on a take()
 * payload and any binding referencing an unsupplied key would fall back to the
 * runtime's per-property fallback (white for color, empty string for text)
 * — wrong if the template author set a default value for that field.
 */
function withDefaults(template: Template, data: Record<string, string>): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const f of template.fields) {
    if (f.default !== undefined) merged[f.key] = f.default;
  }
  Object.assign(merged, data);
  return merged;
}

export type MountedTemplate = {
  /** The DOM root that was mounted into the host. */
  root: HTMLElement;
  /** Map of layerId → DOM element (useful for editor selection overlays). */
  nodes: LayerNodeMap;
  /** GSAP timelines. In `edit` mode they are paused at t=0 — scrub via seek(). */
  timelines: {
    in: gsap.core.Timeline;
    out: gsap.core.Timeline;
  };
  /** Play the `in` timeline. Resolves when the in-animation completes. */
  playIn(): Promise<void>;
  /**
   * Play the `out` timeline AND a root-opacity fade in parallel. Resolves
   * when both have completed. Use for transitions where the entire mount
   * should disappear (different-template take, blank, end-of-song).
   */
  playOut(): Promise<void>;
  /**
   * Play ONLY the template's `out` timeline — no root-opacity fade. Use for
   * transitions where layers outside the template's out timeline (e.g. a
   * gradient shape on a lyric template that intentionally has no IN/OUT
   * animation defined) should stay put across the swap. Resolves when the
   * `out` timeline finishes; returns immediately if `out` has zero duration.
   */
  playOutTimeline(): Promise<void>;
  /**
   * Flash a color overlay above the template `count` times. Each cycle takes
   * `durationMs` (split evenly between opacity 0→1 and 1→0). The overlay is
   * cleaned up when the animation finishes; calling again while a previous
   * blink is still running cancels the old one and starts fresh so two
   * rapid takes don't visibly stack.
   */
  playBlink(opts: BlinkOnTake): Promise<void>;
  /** Seek a named timeline to a given time (for editor scrubbing). */
  seek(timeline: "in" | "out", time: number): void;
  /** Hot-update field-bound text/image content without re-animating. */
  update(data: Record<string, string>): void;
  /** Tear down: remove from DOM and kill timelines. */
  destroy(): void;
};

/**
 * Inject the blink keyframes once per document. Using a CSS animation (vs.
 * a GSAP tween) sidesteps a subtle problem we hit with GSAP: the new tween
 * would race with playIn / songFade GSAP work and sometimes never paint the
 * intermediate frame. CSS keyframes are owned by the browser scheduler and
 * always paint.
 *
 * 0% / 100% are at opacity 0 so the overlay vanishes cleanly between (and
 * after) cycles. 50% is the peak — the animation runs `count` iterations,
 * each `durationMs`, so one cycle = "off → on → off".
 */
const BLINK_KEYFRAMES = `@keyframes overlaysys-blink {
  0%, 100% { opacity: 0; }
  50% { opacity: 1; }
}`;
let blinkKeyframesInjected = false;
function ensureBlinkKeyframes(): void {
  if (blinkKeyframesInjected) return;
  if (typeof document === "undefined") return;
  const style = document.createElement("style");
  style.dataset["overlaysysBlinkKeyframes"] = "1";
  style.textContent = BLINK_KEYFRAMES;
  document.head.appendChild(style);
  blinkKeyframesInjected = true;
}

export function mountTemplate(
  host: HTMLElement,
  template: Template,
  initialData: Record<string, string>,
  options: { mode?: MountMode } = {},
): MountedTemplate {
  const mode = options.mode ?? "live";
  const merged = withDefaults(template, initialData);
  // Kick off font registration in the background. Mount stays synchronous —
  // the browser repaints text once each FontFace resolves, so the only
  // visible effect is a brief FOUT on the very first mount of a template
  // that uses a not-yet-cached font.
  void ensureTemplateFonts(template);
  const { root, nodes, timeBindings } = buildTemplateDom(template, merged);
  host.appendChild(root);

  // Edit mode wants clicks on layers to reach the editor's pointerdown
  // handler. Live mode keeps pointer-events disabled so OBS browser-source
  // and similar passive hosts can't accidentally interact.
  if (mode === "edit") root.style.pointerEvents = "auto";

  const inTl = buildGsapTimeline(template.timelines.in, nodes, { paused: true });
  const outTl = buildGsapTimeline(template.timelines.out, nodes, { paused: true });
  // Note: edit-mode callers (the Canvas component) drive initial scrub
  // explicitly via seek() so they own the "design pose" semantics.

  let currentData = merged;

  // Blink overlay state. We share one overlay div across rapid re-takes;
  // restarting the CSS animation just resets the same node rather than
  // accumulating layers.
  ensureBlinkKeyframes();
  let blinkOverlay: HTMLElement | null = null;
  let blinkTimeout: ReturnType<typeof setTimeout> | null = null;
  function ensureBlinkOverlay(color: string): HTMLElement {
    if (!blinkOverlay) {
      const div = document.createElement("div");
      div.dataset["overlaysysBlink"] = "1";
      div.style.position = "absolute";
      div.style.inset = "0";
      div.style.pointerEvents = "none";
      // High enough to sit above every layer but still inside the stage's
      // overflow:hidden clip so the flash doesn't leak past the 1920×1080
      // box in the editor.
      div.style.zIndex = "9999";
      div.style.opacity = "0";
      root.appendChild(div);
      blinkOverlay = div;
    }
    blinkOverlay.style.background = color;
    return blinkOverlay;
  }

  // Per-frame ticker for time-typed fields. Cheap when `timeBindings` is
  // empty (no template has time fields → no rAF scheduled). When there ARE
  // bindings, one rAF callback updates every span; we de-dupe writes by
  // comparing against the last value so the browser doesn't repaint when
  // the display string hasn't changed (e.g. between frames within the same
  // wall second).
  let rafId: number | null = null;
  const lastWritten = new WeakMap<HTMLElement, string>();
  function tick(): void {
    const now = Date.now();
    for (const b of timeBindings) {
      const next = computeTimeDisplay(b.field, currentData[b.field.key], now);
      if (lastWritten.get(b.el) !== next) {
        b.el.textContent = next;
        lastWritten.set(b.el, next);
      }
    }
    rafId = requestAnimationFrame(tick);
  }
  function startTicker(): void {
    if (rafId != null || timeBindings.length === 0) return;
    // Write once synchronously so the first frame paints correct values
    // instead of whatever resolveBinding produced from the raw anchor string.
    tick();
  }
  function stopTicker(): void {
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }
  startTicker();

  return {
    root,
    nodes,
    timelines: { in: inTl, out: outTl },
    playIn() {
      // Empty timelines (no tracks, or all tracks dropped because their
      // target layers don't exist) have duration 0 in GSAP 3 — and
      // tl.totalDuration(spec.duration) is a no-op on a children-less
      // timeline, so the spec's declared duration doesn't materialize.
      // restart()ing such a timeline never fires onComplete, which hangs
      // every awaiter (notably the renderer's sequential out→in transition,
      // which leaves the previous template stuck on screen forever).
      if (inTl.duration() === 0) return Promise.resolve();
      return playFromStart(inTl);
    },
    playOut() {
      // Always pair the template's OUT with a root-opacity fade so the
      // mount visibly exits regardless of what the OUT timeline targets.
      // Without this, templates whose OUT only animates a subset of
      // layers (e.g. a lyric template that fades the background but
      // leaves the text at full opacity) would snap their unfaded layers
      // off-screen the instant `destroy()` ran. The root fade also
      // covers the "no OUT defined" case the old fallback handled.
      const fade = playDefaultOut(root);
      if (outTl.duration() === 0) return fade;
      // Run both in parallel; resolve when both have completed so the
      // caller's destroy() doesn't fire mid-animation on either path.
      return Promise.all([fade, playFromStart(outTl)]).then(() => undefined);
    },
    playOutTimeline() {
      // Mirror of playIn's empty-timeline guard: a zero-duration outTl
      // would never resolve via playFromStart, so short-circuit. Caller
      // owns deciding whether layers outside outTl should also animate
      // (see playOut for the full-mount-fade variant).
      if (outTl.duration() === 0) return Promise.resolve();
      return playFromStart(outTl);
    },
    playBlink(opts) {
      // Disabled, or pathological config — render nothing rather than no-op
      // silently, since the caller relies on this being cheap to call.
      if (!opts.enabled) return Promise.resolve();
      const count = Math.max(1, Math.floor(opts.count));
      const cycleMs = Math.max(50, opts.durationMs);
      const overlay = ensureBlinkOverlay(opts.color);

      // Cancel any in-flight blink: clear the pending completion timeout and
      // wipe the CSS animation. Without the reflow before re-applying, a
      // rapid re-take wouldn't restart the animation — CSS only restarts on
      // a change, and going from `animation: …` to itself is a no-change.
      if (blinkTimeout) {
        clearTimeout(blinkTimeout);
        blinkTimeout = null;
      }
      overlay.style.animation = "none";
      overlay.style.opacity = "0";
      // Force a layout flush so the browser sees the "none" state before
      // we re-assign the animation property.
      void overlay.offsetHeight;
      overlay.style.animation = `overlaysys-blink ${cycleMs}ms ease ${count}`;

      const totalMs = cycleMs * count;
      return new Promise<void>((resolve) => {
        blinkTimeout = setTimeout(() => {
          blinkTimeout = null;
          overlay.style.animation = "none";
          overlay.style.opacity = "0";
          resolve();
        }, totalMs + 16);
      });
    },
    seek(which, time) {
      const tl = which === "in" ? inTl : outTl;
      tl.pause();
      tl.seek(Math.max(0, Math.min(time, tl.duration())));
    },
    update(data) {
      // Re-derive against defaults each time so removing a key falls back
      // to the field default rather than persisting a stale value.
      currentData = withDefaults(template, { ...currentData, ...data });
      updateTemplateData(template, currentData, nodes as LayerNodeMap);
    },
    destroy() {
      stopTicker();
      if (blinkTimeout) {
        clearTimeout(blinkTimeout);
        blinkTimeout = null;
      }
      inTl.kill();
      outTl.kill();
      root.remove();
    },
  };
}
