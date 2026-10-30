import type { ImageRow, VideoRow } from "@overlaysys/core";
import type { ClientMessage } from "./index";

/**
 * The `media_take` for a video or photo row. Operator and Companion both
 * send this. A photo holds until cleared; a video carries its loop/mute
 * settings only when the row sets them. Size and position travel only
 * when the row sets them (a photo always has a size).
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
    ...(row.position !== undefined ? { position: row.position } : {}),
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
    ...(row.fit !== undefined ? { fit: row.fit } : {}),
    ...(row.loop !== undefined ? { loop: row.loop } : {}),
    ...(row.muted !== undefined ? { muted: row.muted } : {}),
  };
}
