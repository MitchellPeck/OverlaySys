import type { ImageRow, VideoRow } from "@overlaysys/core";
import type { ClientMessage } from "./index";

/**
 * The `media_take` for a video or photo row. Operator and Companion both
 * send this. A photo holds until cleared; a video carries its loop/mute
 * settings only when the row sets them.
 */
export function mediaRowTakeMessage(row: VideoRow | ImageRow, channel: string, showId?: string | null): ClientMessage {
  const common = {
    type: "media_take" as const,
    channel,
    rowId: row.id,
    assetUrl: row.assetUrl,
    ...(row.label !== undefined ? { label: row.label } : {}),
    transitionIn: row.transitionIn,
    transitionOut: row.transitionOut,
    ...(showId ? { showId } : {}),
  };
  if (row.kind === "media") {
    return { ...common, volume: 1, endAction: "hold", mediaType: "image", fit: row.fit };
  }
  return {
    ...common,
    volume: row.volume,
    endAction: row.endAction,
    mediaType: "video",
    ...(row.loop !== undefined ? { loop: row.loop } : {}),
    ...(row.muted !== undefined ? { muted: row.muted } : {}),
  };
}
