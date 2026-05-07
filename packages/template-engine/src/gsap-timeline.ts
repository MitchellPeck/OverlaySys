import gsap from "gsap";
import type { Timeline as TemplateTimeline, EasingSpec } from "@overlaysys/core";
import type { LayerNodeMap } from "./dom";

function easingToGsap(e: EasingSpec): string {
  if (typeof e === "string") return e;
  // cubic-bezier tuple → gsap CustomEase string fallback: power2 default
  // (Without the CustomEase plugin we approximate with a steps-of-bezier string.)
  return `cubic-bezier(${e[0]}, ${e[1]}, ${e[2]}, ${e[3]})`;
}

const PROP_TO_GSAP: Record<string, string> = {
  x: "x",
  y: "y",
  rotation: "rotation",
  scaleX: "scaleX",
  scaleY: "scaleY",
  opacity: "opacity",
  w: "width",
  h: "height",
};

export function buildGsapTimeline(
  spec: TemplateTimeline,
  nodes: LayerNodeMap,
  options: { paused?: boolean } = {},
): gsap.core.Timeline {
  const tl = gsap.timeline({ paused: options.paused ?? true });

  for (const track of spec.tracks) {
    const el = nodes.get(track.layerId);
    if (!el) continue;
    const gsapProp = PROP_TO_GSAP[track.property];
    if (!gsapProp) continue;

    // Sort just in case authoring order is not chronological.
    const kfs = [...track.keyframes].sort((a, b) => a.t - b.t);
    if (kfs.length === 0) continue;

    const first = kfs[0]!;

    // Single keyframe → just snap to that value at its time.
    if (kfs.length === 1) {
      tl.set(el, { [gsapProp]: first.value }, first.t);
      continue;
    }

    // Multi-keyframe: emit one fromTo tween per segment. fromTo locks both
    // start and end values explicitly so the segment is independent of any
    // other tween (or the layer's static design pose) that might be on
    // the same property. This replaces the previous set+to-at-same-position
    // pattern, where two tweens at position 0 fought over the rendering
    // and caused IN animations to look like hard cuts rather than fades.
    //
    // Default immediateRender (true) means GSAP applies the "from" values
    // when the tween is constructed — so for a timeline like the IN, the
    // first segment's `from` (opacity=0, x=-75) is written to the DOM at
    // construction. mount.ts orders construction so the IN is built last
    // and its t=0 state is the final mounted state, rather than the layer's
    // static design pose.
    for (let i = 1; i < kfs.length; i++) {
      const prev = kfs[i - 1]!;
      const cur = kfs[i]!;
      const dur = cur.t - prev.t;
      tl.fromTo(
        el,
        { [gsapProp]: prev.value },
        {
          [gsapProp]: cur.value,
          duration: dur,
          ease: easingToGsap(cur.easing),
        },
        prev.t,
      );
    }
  }

  // Force the timeline to span the declared duration.
  tl.totalDuration(spec.duration);
  return tl;
}
