import type { ChannelState, SectionKind, Show, Song, Template } from "@overlaysys/core";
import type { ClientMessage } from "@overlaysys/ws-protocol";
import { graphicRowMessage, type RowDataOverrides } from "./rowData";
import { songCueChannel, songTakeChannel } from "./songChannel";
import { onAirMediaFor, videoRowTakeMessage } from "./mediaTake";
import { slidesRowTakeMessages } from "./slidesRowView";
import { sectionAvailable } from "./songNav";

type Row = Show["rows"][number];

export type RowFireCtx = {
  show: Show;
  overrides: RowDataOverrides;
  caches: { songCache: Record<string, Song>; templateCache: Record<string, Template> };
  channelStates: Record<string, ChannelState>;
};

/**
 * What Cue or Take on one rundown row sends: the rundown's Cue / Take
 * buttons, Enter, Space and double-click all go through here. Cue always
 * targets preview (D7a) and video has no Cue. A video already on air sends
 * nothing (Space toggles its pause instead, in the caller).
 */
export function rowFireMessages(row: Row, action: "cue" | "take", ctx: RowFireCtx): ClientMessage[] {
  const { show } = ctx;
  switch (row.kind) {
    case "graphic":
      return [graphicRowMessage(row, action, ctx.overrides, show.id)];
    case "song": {
      const channel = action === "take" ? songTakeChannel(row, show, ctx.caches) : songCueChannel(row, show, ctx.caches);
      return [{ type: "song_take", channel, showId: show.id, songRowId: row.id }];
    }
    case "scripture": {
      if (row.slides.length === 0) return [];
      if (action === "cue") {
        return [{ type: "scripture_take_slide", showId: show.id, rowId: row.id, slideIdx: 0, channel: "preview" }];
      }
      // The first slide, or the next one when this scripture is already live on its channel.
      const channel = row.channelHint ?? "program";
      const live = ctx.channelStates[channel]?.scriptureSession;
      const slideIdx = live?.rowId === row.id ? Math.min(live.slideIdx + 1, row.slides.length - 1) : 0;
      return [{ type: "scripture_take_slide", showId: show.id, rowId: row.id, slideIdx, channel }];
    }
    case "video":
      if (action === "cue") return [];
      if (onAirMediaFor(row, ctx.channelStates)) return [];
      return [videoRowTakeMessage(row, show.id)];
    case "slides":
      return slidesRowTakeMessages(show.id, row, action) ?? [];
    default:
      return [];
  }
}

/** The section a song key jumps to: C/B/T and 1–9, 0 (verse 10). Null for other keys. */
export function sectionKeyFor(key: string): { kind: SectionKind; ordinal: number } | null {
  const k = key.toLowerCase();
  if (k === "c") return { kind: "chorus", ordinal: 1 };
  if (k === "b") return { kind: "bridge", ordinal: 1 };
  if (k === "t") return { kind: "tag", ordinal: 1 };
  if (/^[0-9]$/.test(k)) return { kind: "verse", ordinal: k === "0" ? 10 : Number(k) };
  return null;
}

/** "No chorus in this arrangement", "No verse 3 in this arrangement". */
export function sectionMissingText(kind: SectionKind, ordinal: number): string {
  const name = kind === "verse" ? `verse ${ordinal}` : kind;
  return `No ${name} in this arrangement`;
}

/**
 * What a song section key does: the jump message, or the toast text when the
 * song has no such section (nothing is sent). An uncached song can't be
 * checked, so the jump goes out and the server decides.
 */
export function sectionKeyAction(
  target: { kind: SectionKind; ordinal: number },
  song: Pick<Song, "sections"> | undefined,
  arrangement: string[],
): { send: ClientMessage } | { toast: string } {
  if (song && !sectionAvailable(song, arrangement, target.kind, target.ordinal)) {
    return { toast: sectionMissingText(target.kind, target.ordinal) };
  }
  return { send: { type: "song_jump_kind", channel: "program", kind: target.kind, ordinal: target.ordinal } };
}

/** The first Esc press arms; this is what it says, per key mode. */
export function escArmText(mode: "song" | "other"): string {
  return mode === "song" ? "Press Esc again to end song" : "Press Esc again to clear program";
}
