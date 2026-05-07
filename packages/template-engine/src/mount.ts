import type { Template } from "@overlaysys/core";
import type gsap from "gsap";
import {
  buildTemplateDom,
  updateTemplateData,
  type LayerNodeMap,
} from "./dom";
import { buildGsapTimeline } from "./gsap-timeline";

export type MountMode = "live" | "edit";

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
  const { root, nodes } = buildTemplateDom(template, merged);
  host.appendChild(root);

  // Edit mode wants clicks on layers to reach the editor's pointerdown
  // handler. Live mode keeps pointer-events disabled so OBS browser-source
  // and similar passive hosts can't accidentally interact.
  if (mode === "edit") root.style.pointerEvents = "auto";

  // Construction order matters: GSAP fromTo tweens immediate-render their
  // "from" values, so whichever timeline is built LAST wins on shared
  // properties. Build OUT first, IN second — the IN timeline's t=0
  // values (opacity=0, x=-75, etc.) end up applied to the DOM at mount
  // time, so the layer is already at its in-start state before the first
  // paint. Without this, the layer would briefly show its static design
  // pose (opacity=1) until playIn() drove the timeline forward, making
  // the in-animation look like a snap.
  //
  // Edit-mode callers drive initial scrubbing explicitly via seek() so
  // they own the "design pose" semantics — they're unaffected by the
  // ordering choice.
  const outTl = buildGsapTimeline(template.timelines.out, nodes, { paused: true });
  const inTl = buildGsapTimeline(template.timelines.in, nodes, { paused: true });

  let currentData = merged;

  return {
    root,
    nodes,
    timelines: { in: inTl, out: outTl },
    playIn() {
      return new Promise<void>((resolve) => {
        inTl.eventCallback("onComplete", () => resolve());
        // Invalidate before restarting: GSAP caches each tween's "rendered"
        // state internally, and on subsequent restarts will skip re-applying
        // the from values if it thinks they were already written. Calling
        // invalidate() drops the cache so restart(true) actually re-renders
        // each tween's start values, including the all-important t=0 from.
        inTl.invalidate();
        inTl.restart(true);
      });
    },
    playOut() {
      return new Promise<void>((resolve) => {
        outTl.eventCallback("onComplete", () => resolve());
        outTl.invalidate();
        outTl.restart(true);
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
      inTl.kill();
      outTl.kill();
      root.remove();
    },
  };
}
