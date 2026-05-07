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

    // First keyframe sets the initial value at its time.
    if (kfs.length === 0) continue;
    const first = kfs[0]!;
    tl.set(el, { [gsapProp]: first.value }, first.t);

    for (let i = 1; i < kfs.length; i++) {
      const prev = kfs[i - 1]!;
      const cur = kfs[i]!;
      const dur = cur.t - prev.t;
      tl.to(
        el,
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
