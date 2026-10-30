import type { ChannelMedia, MediaTransitionStyle } from "@overlaysys/core";
import { initialMountPlan } from "./mediaSync";

/**
 * Pure helpers for video In/Out transitions. MediaLayer keeps an outgoing
 * take mounted while it animates out (the graphic playOut() pattern), so a
 * clear fades instead of cutting and a new take crossfades over the old one.
 */

export type TransitionDirection = "in" | "out";

/** Off-stage pose for each style; the on-stage pose is always opacity 1, no transform. */
const OFFSTAGE: Record<Exclude<MediaTransitionStyle, "cut">, Record<TransitionDirection, Keyframe>> = {
  fade: { in: { opacity: 0 }, out: { opacity: 0 } },
  // Push in: arrives from slightly large, leaves by growing slightly.
  zoom: {
    in: { opacity: 0, transform: "scale(1.06)" },
    out: { opacity: 0, transform: "scale(1.06)" },
  },
  // Rises in from below, keeps rising on the way out.
  slide: {
    in: { opacity: 0, transform: "translateY(80px)" },
    out: { opacity: 0, transform: "translateY(-80px)" },
  },
};

/** Web Animations keyframes for a transition, or null for a cut. */
export function transitionKeyframes(style: MediaTransitionStyle, dir: TransitionDirection): Keyframe[] | null {
  if (style === "cut") return null;
  const off = OFFSTAGE[style][dir];
  const on: Keyframe = style === "fade" ? { opacity: 1 } : { opacity: 1, transform: "none" };
  return dir === "in" ? [off, on] : [on, off];
}

/** Fades ease both ways (crossfades stay even); motion decelerates in, accelerates out. */
export function transitionEasing(style: MediaTransitionStyle, dir: TransitionDirection): string {
  if (style === "fade" || style === "cut") return "ease-in-out";
  return dir === "in" ? "cubic-bezier(0.22, 1, 0.36, 1)" : "cubic-bezier(0.64, 0, 0.78, 0)";
}

/** Linear audio ramp from `from` to `to` over `durationMs`. */
export function rampGain(from: number, to: number, elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0) return to;
  const k = Math.min(1, Math.max(0, elapsedMs / durationMs));
  return from + (to - from) * k;
}

/**
 * Playback time (s) at which a self-clearing video should start its Out
 * transition so the fade lands on the last frame. Null when the video holds
 * at the end, loops, cuts out, or its duration isn't known yet.
 */
export function endFadeStartsAt(media: ChannelMedia, duration: number): number | null {
  if (media.endAction !== "clear") return null;
  if (media.loop) return null;
  if (media.transitionOut.style === "cut") return null;
  if (!Number.isFinite(duration) || duration <= 0) return null;
  return Math.max(0, duration - media.transitionOut.durationMs / 1000);
}

/** A renderer rejoining mid-video shows it immediately rather than replaying the In. */
export function shouldAnimateIn(media: ChannelMedia): boolean {
  if (media.transitionIn.style === "cut") return false;
  return initialMountPlan(media).startAt === 0;
}

export type MediaLayerEntry = {
  media: ChannelMedia;
  /** Non-null once this take is on its way out; `cut` skips the animation. */
  leaving: { cut: boolean } | null;
};

/**
 * Fold the channel's current media into the renderer's layer stack. The
 * last entry is on top, so a new take dissolves in over the outgoing one.
 * Returns the same array when nothing changed so React can bail out.
 */
export function nextLayers(
  layers: MediaLayerEntry[],
  media: ChannelMedia | null,
  clearCut: boolean,
): MediaLayerEntry[] {
  let changed = false;
  let found = false;
  const out = layers.map((l) => {
    if (l.leaving) return l;
    if (media && l.media.takenAt === media.takenAt) {
      found = true;
      if (l.media === media) return l;
      changed = true;
      return { ...l, media };
    }
    changed = true;
    return { ...l, leaving: { cut: media ? false : clearCut } };
  });
  if (media && !found) {
    out.push({ media, leaving: null });
    changed = true;
  }
  return changed ? out : layers;
}
