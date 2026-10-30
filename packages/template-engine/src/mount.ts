import type { BlinkOnTake, Field, Layer, Template } from "@overlaysys/core";
import { createTicker } from "./ticker";
import { computeTimeDisplay } from "@overlaysys/core";
import gsap from "gsap";
import {
  applyLayerAppearance,
  applyTransform,
  applyVisibility,
  buildTemplateDom,
  indexLayers,
  revealClipPath,
  revealRefBox,
  updateTemplateData,
  type LayerNodeMap,
} from "./dom";
import { ensureTemplateFonts } from "./fonts";
import { PROP_TO_GSAP, WIPE_VAR, buildGsapTimeline, clearWipeMask } from "./gsap-timeline";
import { planTemplatePatch } from "./patchPlan";
import { applyShrinkFit } from "./textFit";

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
 * Longest a fresh live mount waits for its fonts and images before the IN
 * animation starts. Long enough to cover a cached font / decoded image (no
 * first-take font flash), short enough that a slow asset never holds a take.
 */
export const ASSET_WAIT_CAP_MS = 300;

function eachLayer(layers: Layer[], fn: (l: Layer) => void): void {
  for (const l of layers) {
    fn(l);
    if (l.type === "group") eachLayer(l.children, fn);
  }
}

/** Font shorthand that makes `document.fonts.load` fetch a text layer's face. */
function fontSpec(l: Extract<Layer, { type: "text" }>): string {
  const s = l.style;
  return `${s.italic ? "italic " : ""}${s.fontWeight} ${s.fontSize}px ${s.fontFamily}`;
}

/**
 * Resolve when the template's embedded fonts, the faces its text layers use
 * and its images are ready, or after `capMs`, whichever is first. Never
 * rejects.
 */
function waitForAssets(
  template: Template,
  nodes: LayerNodeMap,
  fontsLoading: Promise<void>,
  capMs: number,
): Promise<void> {
  const tasks: Promise<unknown>[] = [fontsLoading.catch(() => {})];
  const fonts = typeof document !== "undefined" && "fonts" in document ? document.fonts : null;
  eachLayer(template.layers, (l) => {
    if (l.type === "text" && fonts) {
      try {
        tasks.push(fonts.load(fontSpec(l)).catch(() => {}));
      } catch {
        // An unparseable family name; the cap still bounds the wait.
      }
    } else if (l.type === "image") {
      const img = nodes.get(l.id) as HTMLImageElement | undefined;
      if (img && img.getAttribute("src") && typeof img.decode === "function") {
        tasks.push(img.decode().catch(() => {}));
      }
    }
  });
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, capMs);
    void Promise.all(tasks).then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

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
  /**
   * GSAP timelines. In `edit` mode they are paused at t=0 — scrub via seek().
   * `patch()` rebuilds them, so read this property each time.
   */
  readonly timelines: {
    in: gsap.core.Timeline;
    out: gsap.core.Timeline;
  };
  /**
   * Resolves once the template's fonts and images are ready, or after
   * ASSET_WAIT_CAP_MS. In `live` mode the mount stays invisible until then
   * (or until playIn starts), so the first take doesn't flash fallback fonts.
   */
  ready: Promise<void>;
  /**
   * Play the `in` timeline. Resolves when the in-animation completes. On a
   * fresh mount it first waits for `ready`.
   */
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
   * Auto-out exit: play ONLY the template's `out` timeline when it has one,
   * so a designed exit isn't cut short by the root fade; with no OUT, fall
   * back to the default root fade so the graphic still leaves visibly.
   */
  playAutoOut(): Promise<void>;
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
  /**
   * Editor scrub: show `timeline` at `time`, parking the other one at the
   * design pose (`in` at its end, `out` at its start). Re-applied after patch().
   */
  scrub(timeline: "in" | "out", time: number): void;
  /**
   * Apply an edited version of the template to the existing DOM (restyle the
   * changed layers, rebuild the timelines). Returns false when the change is
   * structural (layers added/removed/reordered, fields, fonts, size, video
   * source…); the caller then destroys and remounts.
   */
  patch(next: Template): boolean;
  /**
   * The animated value a track property currently has on a layer (x/y are
   * translate offsets), or null for an unknown layer/property.
   */
  getProperty(layerId: string, property: string): number | null;
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
  options: { mode?: MountMode; static?: boolean } = {},
): MountedTemplate {
  const mode = options.mode ?? "live";
  let current = template;
  const merged = withDefaults(template, initialData);
  // Font registration starts now; mount stays synchronous. A live mount is
  // kept invisible until `ready` (fonts + images, capped) so the first take
  // doesn't paint a fallback face and then swap it in.
  const fontsLoading = ensureTemplateFonts(template);
  const { root, nodes, timeBindings } = buildTemplateDom(template, merged);
  if (mode === "live") root.style.visibility = "hidden";
  host.appendChild(root);

  // Edit mode wants clicks on layers to reach the editor's pointerdown
  // handler. Live mode keeps pointer-events disabled so OBS browser-source
  // and similar passive hosts can't accidentally interact.
  if (mode === "edit") root.style.pointerEvents = "auto";

  let inTl: gsap.core.Timeline;
  let outTl: gsap.core.Timeline;
  try {
    inTl = buildGsapTimeline(template.timelines.in, nodes, { paused: true });
    outTl = buildGsapTimeline(template.timelines.out, nodes, { paused: true });
  } catch (err) {
    // Malformed tracks: don't leave the already-attached root orphaned on the stage.
    root.remove();
    throw err;
  }
  // Note: edit-mode callers (the Canvas component) drive initial scrub
  // explicitly via seek()/scrub() so they own the "design pose" semantics.
  let lastScrub: { which: "in" | "out"; time: number } | null = null;

  let currentData = merged;
  let destroyed = false;
  let outStarted = false;
  let playInRequested = false;
  let assetsSettled = false;
  let revealed = mode !== "live";
  function reveal(): void {
    if (revealed) return;
    revealed = true;
    root.style.visibility = "";
  }

  /** Shrink-to-fit text layers; needs layout, so only once attached. */
  function fitText(): void {
    if (destroyed) return;
    eachLayer(current.layers, (l) => {
      if (l.type !== "text" || l.fit !== "shrink") return;
      const el = nodes.get(l.id);
      if (el) applyShrinkFit(el, l);
    });
  }
  fitText();

  const ready = waitForAssets(template, nodes, fontsLoading, ASSET_WAIT_CAP_MS).then(() => {
    assetsSettled = true;
    // Font metrics may have changed the fit.
    fitText();
    // Nobody is going to play this mount in: show it as built.
    if (!playInRequested) reveal();
  });

  function startIn(): Promise<void> {
    // Empty timelines (no tracks, or all tracks dropped because their
    // target layers don't exist) have duration 0 in GSAP 3 — and
    // tl.totalDuration(spec.duration) is a no-op on a children-less
    // timeline, so the spec's declared duration doesn't materialize.
    // restart()ing such a timeline never fires onComplete, which hangs
    // every awaiter (notably the renderer's sequential out→in transition,
    // which leaves the previous template stuck on screen forever).
    if (inTl.duration() === 0) {
      reveal();
      return Promise.resolve();
    }
    // Priming (inside playFromStart) writes the from-values synchronously,
    // so revealing just before it never shows the design pose.
    const p = playFromStart(inTl);
    reveal();
    return p;
  }

  // clipBy wrappers bake the reference's static box into their clip-path at
  // build. When a timeline moves/sizes/scales the reference, re-derive the
  // clip from its animated values so the reveal edge follows it. The
  // wrappers only change on a remount, so collect them once.
  const revealClips = Array.from(root.querySelectorAll<HTMLElement>("[data-clip-for]"));
  let clipIndex: { for: Template; layers: Map<string, Layer> } | null = null;
  // Compared against what we last wrote: the browser normalises style.clipPath.
  const lastClip = new Map<HTMLElement, string>();
  function syncRevealClips(): void {
    if (revealClips.length === 0) return;
    if (clipIndex?.for !== current) clipIndex = { for: current, layers: indexLayers(current.layers) };
    const layers = clipIndex.layers;
    for (const wrapper of revealClips) {
      const layer = layers.get(wrapper.dataset["clipFor"] ?? "");
      const ref = layer?.clipBy && layers.get(layer.clipBy.layerId);
      const refEl = ref && nodes.get(ref.id);
      if (!layer?.clipBy || !ref || !refEl) continue;
      const num = (v: unknown, fallback: number) => {
        const n = parseFloat(String(v));
        return Number.isFinite(n) ? n : fallback;
      };
      const box = revealRefBox(ref.transform, {
        dx: num(gsap.getProperty(refEl, "x"), 0),
        dy: num(gsap.getProperty(refEl, "y"), 0),
        // A w/h track writes the inline size; otherwise it's the declared one.
        w: num(refEl.style.width, ref.transform.w ?? 0),
        h: num(refEl.style.height, ref.transform.h ?? 0),
        scaleX: num(gsap.getProperty(refEl, "scaleX"), ref.transform.scaleX),
        scaleY: num(gsap.getProperty(refEl, "scaleY"), ref.transform.scaleY),
      });
      const clip = revealClipPath(
        box,
        layer.clipBy.hide,
        Number(wrapper.dataset["clipW"]),
        Number(wrapper.dataset["clipH"]),
      );
      if (lastClip.get(wrapper) === clip) continue;
      wrapper.style.clipPath = clip;
      lastClip.set(wrapper, clip);
    }
  }

  function applyScrub(which: "in" | "out", time: number): void {
    // Both timelines target the same DOM. The active one is seeked; the
    // other is parked at the boundary that represents the design pose so
    // its values don't linger on the canvas.
    if (which === "in") outTl.totalProgress(0).pause();
    else inTl.totalProgress(1).pause();
    const tl = which === "in" ? inTl : outTl;
    tl.pause();
    tl.seek(Math.max(0, Math.min(time, tl.duration())));
    syncRevealClips();
  }

  function fieldsMap(t: Template): Map<string, Field> {
    const m = new Map<string, Field>();
    for (const f of t.fields) m.set(f.key, f);
    return m;
  }

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
  const lastWritten = new WeakMap<HTMLElement, string>();
  function paintFrame(): void {
    const now = Date.now();
    for (const b of timeBindings) {
      const next = computeTimeDisplay(b.field, currentData[b.field.key], now);
      if (lastWritten.get(b.el) !== next) {
        b.el.textContent = next;
        lastWritten.set(b.el, next);
      }
    }
    syncRevealClips();
  }
  // `static` (thumbnails): paint on demand, never schedule a rAF loop.
  const ticker = createTicker(paintFrame, { static: options.static });
  function startTicker(): void {
    if (timeBindings.length === 0 && revealClips.length === 0) return;
    // Write once synchronously so the first frame paints correct values
    // instead of whatever resolveBinding produced from the raw anchor string.
    ticker.start();
  }
  function stopTicker(): void {
    ticker.stop();
  }
  startTicker();

  return {
    root,
    nodes,
    get timelines() {
      return { in: inTl, out: outTl };
    },
    ready,
    playIn() {
      playInRequested = true;
      if (assetsSettled || destroyed) return startIn();
      return ready.then(() => {
        // A newer take may have played this mount out (or destroyed it)
        // while we waited; don't run the IN over that.
        if (destroyed || outStarted) return;
        return startIn();
      });
    },
    playOut() {
      outStarted = true;
      reveal();
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
      reveal();
      // Mirror of playIn's empty-timeline guard: a zero-duration outTl
      // would never resolve via playFromStart, so short-circuit. Caller
      // owns deciding whether layers outside outTl should also animate
      // (see playOut for the full-mount-fade variant).
      if (outTl.duration() === 0) return Promise.resolve();
      return playFromStart(outTl);
    },
    playAutoOut() {
      outStarted = true;
      reveal();
      if (outTl.duration() === 0) return playDefaultOut(root);
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
      syncRevealClips();
    },
    scrub(which, time) {
      lastScrub = { which, time };
      applyScrub(which, time);
      if (options.static) ticker.paintNow();
    },
    patch(next) {
      if (destroyed) return false;
      const plan = planTemplatePatch(current, next);
      if (!plan) return false;
      if (plan.layers.length === 0 && !plan.timelines) {
        current = next;
        return true;
      }
      const data = withDefaults(next, currentData);
      const fields = fieldsMap(next);
      inTl.kill();
      outTl.kill();
      // A changed timeline can leave stale animated values on any layer it
      // used to target, so then every layer is reset to its static pose.
      const restyle: Layer[] = [];
      if (plan.timelines) eachLayer(next.layers, (l) => restyle.push(l));
      else restyle.push(...plan.layers);
      for (const l of restyle) {
        const el = nodes.get(l.id);
        if (!el) continue;
        // Drop GSAP's cached transform (x/y translate etc.) with the inline
        // transform; the rebuilt timelines write animated values back.
        gsap.set(el, { clearProps: "transform" });
        clearWipeMask(el);
        applyLayerAppearance(el, l, data, fields);
        applyTransform(el, l.transform);
        applyVisibility(el, l);
      }
      current = next;
      currentData = data;
      inTl = buildGsapTimeline(next.timelines.in, nodes, { paused: true });
      outTl = buildGsapTimeline(next.timelines.out, nodes, { paused: true });
      if (lastScrub) applyScrub(lastScrub.which, lastScrub.time);
      else syncRevealClips();
      fitText();
      return true;
    },
    getProperty(layerId, property) {
      const el = nodes.get(layerId);
      const prop = PROP_TO_GSAP[property];
      if (!el || !prop) return null;
      if (prop === WIPE_VAR) {
        const v = parseFloat(el.style.getPropertyValue(WIPE_VAR));
        return Number.isFinite(v) ? v / 100 : 1;
      }
      const v = gsap.getProperty(el, prop);
      const n = typeof v === "number" ? v : parseFloat(String(v));
      return Number.isFinite(n) ? n : null;
    },
    update(data) {
      // Re-derive against defaults each time so removing a key falls back
      // to the field default rather than persisting a stale value.
      currentData = withDefaults(current, { ...currentData, ...data });
      updateTemplateData(current, currentData, nodes as LayerNodeMap);
      fitText();
      if (options.static) ticker.paintNow();
    },
    destroy() {
      destroyed = true;
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
