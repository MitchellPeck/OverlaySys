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

    // Single keyframe: just snap to the value at its time. (No animation.)
    if (kfs.length === 1) {
      tl.set(el, { [gsapProp]: kfs[0]!.value }, kfs[0]!.t);
      continue;
    }

    // Multi-keyframe: emit one fromTo per segment.
    //
    // Why fromTo instead of set+to-at-same-position: with the previous
    // approach, GSAP could capture the to()'s "from" value before the set
    // ran (because they were both at position 0), causing the animation
    // to come from the static design pose rather than the keyframe's
    // start value. For an IN like "opacity 0→1" where the static pose is
    // 1, this meant opacity animated 1→1 (no visible change) while the
    // set silently wrote 0 — so the IN looked like a hard cut.
    //
    // fromTo locks both endpoints into a single tween. immediateRender:
    // false defers the from-write until the timeline actually plays, so
    // multiple paused timelines on the same element (IN + OUT during
    // construction) don't fight over which from-value gets written first.
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
          immediateRender: false,
        },
        prev.t,
      );
    }
  }

  // Force the timeline to span the declared duration.
  tl.totalDuration(spec.duration);
  return tl;
}
