import type { ChannelState } from "@overlaysys/core";
import type { ClientMessage } from "@overlaysys/ws-protocol";
import type { RowLike } from "./rowLike";

type States = Record<string, ChannelState | undefined>;

// Live keys (Space, Shift+Space, B) go through keyMode in shortcutGuards, which
// calls slidesKeyChannel / slidesAdvanceMessage / slidesBlankMessage.

/** Click on a thumbnail: goto if this row is live on program, else cue to preview. */
export function slidesThumbClickMessage(a: {
  showId: string;
  row: RowLike;
  position: number;
  states: States;
}): ClientMessage {
  if (a.states.program?.slidesSession?.rowId === a.row.id) {
    return { type: "slides_goto", channel: "program", slideIdx: a.position };
  }
  return { type: "slides_take", showId: a.showId, rowId: a.row.id, slideIdx: a.position, channel: "preview" };
}

/** A take goes to row.channelHint ?? "program"; a cue goes to "preview". */
export function slidesRowTakeMessage(showId: string, row: RowLike, action: "cue" | "take"): ClientMessage {
  const hint = (row as { channelHint?: string }).channelHint;
  return { type: "slides_take", showId, rowId: row.id, channel: action === "cue" ? "preview" : (hint ?? "program") };
}
