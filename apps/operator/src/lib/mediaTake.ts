import type { VideoRow } from "@overlaysys/core";
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
  };
}

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
