import type { ClientMessage } from "@overlaysys/ws-protocol";
import type { RowLike } from "./rowLike";

// Live keys (Space, Shift+Space, B) go through keyMode in shortcutGuards, which
// calls slidesKeyChannel / slidesAdvanceMessage / slidesBlankMessage. Thumbnail
// clicks go through slidesThumbMessages in slidesRowView.

/** A take goes to row.channelHint ?? "program"; a cue goes to "preview". */
export function slidesRowTakeMessage(showId: string, row: RowLike, action: "cue" | "take"): ClientMessage {
  const hint = (row as { channelHint?: string }).channelHint;
  return { type: "slides_take", showId, rowId: row.id, channel: action === "cue" ? "preview" : (hint ?? "program") };
}
