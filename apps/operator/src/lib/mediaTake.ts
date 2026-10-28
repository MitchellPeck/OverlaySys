import type { ChannelMedia, ChannelState, VideoRow } from "@overlaysys/core";
import type { ClientMessage } from "@overlaysys/ws-protocol";

/** Media takes go straight to their channel — there is no PVW stage for video. */
export function videoRowTakeMessage(row: VideoRow, showId?: string): ClientMessage {
  return {
    type: "media_take",
    channel: row.channelHint ?? "program",
    rowId: row.id,
    assetUrl: row.assetUrl,
    ...(row.label !== undefined ? { label: row.label } : {}),
    volume: row.volume,
    endAction: row.endAction,
    transitionIn: row.transitionIn,
    transitionOut: row.transitionOut,
    ...(showId ? { showId } : {}),
  };
}

/**
 * The media currently on air for this row (same row, its channel, not
 * ended/errored), or null. While non-null, Take/double-click must not
 * re-take the row; Space toggles pause instead.
 */
export function onAirMediaFor(
  row: VideoRow,
  channelStates: Record<string, ChannelState>,
): ChannelMedia | null {
  const media = channelStates[row.channelHint ?? "program"]?.media;
  if (!media || media.rowId !== row.id) return null;
  if (media.playback.status === "ended" || media.playback.status === "error") return null;
  return media;
}

/**
 * Server route that serves a JPEG frame of a stored video (rundown
 * thumbnails). Null for URLs the local asset server didn't store.
 */
export function posterPathFor(assetUrl: string): string | null {
  const m = /^\/assets\/([A-Za-z0-9]+\.(?:mp4|webm))$/i.exec(assetUrl);
  return m ? `/api/assets/poster/${m[1]}` : null;
}

/**
 * Where a key on the seek slider moves playback: ←/↓ back and →/↑ forward
 * 5 s (Shift: 15 s), Home to the start, End to 1 s before the end. Null for
 * other keys or unknown duration.
 */
export function seekTargetForKey(key: string, shift: boolean, elapsed: number, duration: number): number | null {
  if (!(duration > 0)) return null;
  const step = shift ? 15 : 5;
  const clamp = (t: number) => Math.min(Math.max(0, duration - 1), Math.max(0, t));
  switch (key) {
    case "ArrowLeft":
    case "ArrowDown":
      return clamp(elapsed - step);
    case "ArrowRight":
    case "ArrowUp":
      return clamp(elapsed + step);
    case "Home":
      return 0;
    case "End":
      return clamp(duration - 1);
    default:
      return null;
  }
}

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
