import type { ChannelMedia, ChannelState, VideoRow } from "@overlaysys/core";
import type { ClientMessage } from "@overlaysys/ws-protocol";

/** Media takes go straight to their channel — there is no PVW stage for video. */
export function videoRowTakeMessage(row: VideoRow): ClientMessage {
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

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
