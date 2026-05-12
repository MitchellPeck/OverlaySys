import type { Template } from "@overlaysys/core";
import type gsap from "gsap";
import {
  buildTemplateDom,
  updateTemplateData,
  type LayerNodeMap,
} from "./dom";
import { ensureTemplateFonts } from "./fonts";
import { buildGsapTimeline } from "./gsap-timeline";

export type MountMode = "live" | "edit";

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
  /** Play the `out` timeline. Resolves when the out-animation completes. */
  playOut(): Promise<void>;
  /** Seek a named timeline to a given time (for editor scrubbing). */
  seek(timeline: "in" | "out", time: number): void;
  /** Hot-update field-bound text/image content without re-animating. */
  update(data: Record<string, string>): void;
  /** Tear down: remove from DOM and kill timelines. */
  destroy(): void;
};

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
  const { root, nodes } = buildTemplateDom(template, merged);
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
      if (outTl.duration() === 0) return Promise.resolve();
      return playFromStart(outTl);
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
      inTl.kill();
      outTl.kill();
      root.remove();
    },
  };
}
