import type { ChannelMedia } from "@overlaysys/core";

/** Reports arrive every 250 ms while playing; 3 s of silence means no renderer. */
export const NO_RENDERER_MS = 3_000;
/** Never extrapolate more than this past the last report (stalls, hiccups). */
const MAX_EXTRAPOLATE_S = 1;

export type MediaDisplayStatus = "loading" | "playing" | "paused" | "ended" | "error" | "no-renderer";

/**
 * Progress for display. Interpolates with the operator's LOCAL clock from
 * when the last report was received — server `updatedAt` is another
 * machine's clock and may be skewed.
 */
export function displayTime(
  m: ChannelMedia,
  heardAtLocal: number,
  nowLocal: number,
): { elapsed: number; remaining: number; fraction: number } {
  const { status, currentTime, duration } = m.playback;
  let elapsed = currentTime;
  if (status === "playing") {
    elapsed += Math.min(MAX_EXTRAPOLATE_S, Math.max(0, (nowLocal - heardAtLocal) / 1000));
  }
  if (duration > 0) elapsed = Math.min(elapsed, duration);
  const remaining = duration > 0 ? Math.max(0, duration - elapsed) : 0;
  const fraction = duration > 0 ? elapsed / duration : 0;
  return { elapsed, remaining, fraction };
}

export function displayStatus(m: ChannelMedia, heardAtLocal: number, nowLocal: number): MediaDisplayStatus {
  const s = m.playback.status;
  if ((s === "playing" || s === "loading") && nowLocal - heardAtLocal > NO_RENDERER_MS) {
    return "no-renderer";
  }
  return s;
}

/** Seconds left at which the remaining clock turns amber, then red. */
export const END_WARN_S = 15;
export const END_URGENT_S = 5;

export type RemainingTone = "normal" | "warn" | "urgent";

export function remainingTone(remaining: number, duration: number): RemainingTone {
  if (duration <= 0) return "normal";
  if (remaining <= END_URGENT_S) return "urgent";
  if (remaining <= END_WARN_S) return "warn";
  return "normal";
}

/** A monitor video further than this from the output's position is re-seeked. */
export const PREVIEW_DRIFT_S = 0.5;
/** How often a monitor video is checked for drift. */
export const PREVIEW_SYNC_INTERVAL_MS = 2_000;

/**
 * Where a PVW/PGM monitor's muted copy of a channel video should be, from
 * the renderer's last report. Unlike `displayTime`, the extrapolation isn't
 * capped: the monitor video plays on its own between reports, so capping
 * would drag it back. `time` is null until a renderer has reported a
 * position (status "loading"), so the monitor isn't seeked to 0 meanwhile.
 */
export function previewVideoSync(
  m: ChannelMedia,
  heardAtLocal: number,
  nowLocal: number,
): { time: number | null; paused: boolean } {
  const { status, currentTime, duration } = m.playback;
  const paused = m.paused || status === "paused" || status === "ended" || status === "error";
  if (status === "loading") return { time: null, paused };
  let time = currentTime;
  if (status === "playing" && !m.paused) time += Math.max(0, (nowLocal - heardAtLocal) / 1000);
  if (duration > 0) time = Math.min(time, duration);
  return { time, paused };
}

/** True when the monitor video has drifted far enough from the target to seek. */
export function previewNeedsSeek(current: number, target: number | null): boolean {
  return target !== null && Math.abs(current - target) > PREVIEW_DRIFT_S;
}
