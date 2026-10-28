import type { ChannelState, Deck, SlidesRowFields, SlidesRowView } from "@overlaysys/core";
import { SLIDES_END_OF_DECK, slidesRowView } from "@overlaysys/core";
import type { ClientMessage } from "@overlaysys/ws-protocol";
import { useStore } from "./store";
import { useDeck } from "../app/slides/useDeck";
import type { RowLike } from "./rowLike";
import type { AirState } from "./rowAirState";
import { slidesRowTakeMessage } from "./slidesLive";

/**
 * Slides adapter (contracts §9). Live and the show editor reach slides rows
 * only through this file.
 */

/** Whether the show editor's "+ Add item" offers Slides. */
export const slidesAddItemEnabled = true;

/** The deck cache, keyed by deck id. */
export function useDeckCache(): Record<string, Deck> {
  return useStore((s) => s.deckCache);
}

/** The deck a slides row points at: undefined = not loaded, null = missing or deleted. */
export function useDeckFor(row: RowLike): Deck | null | undefined {
  const id = row.kind === "slides" ? row.deckId : undefined;
  const d = useDeck(id);
  if (!id) return null;
  return d?.deletedAt ? null : d;
}

export function slidesRowViewFor(row: RowLike, deck: Deck | null | undefined): SlidesRowView | null {
  if (row.kind !== "slides") return null;
  const d = deck?.deletedAt ? null : deck;
  return slidesRowView(row as SlidesRowFields, d);
}

export function slidesAirState(row: RowLike, channelStates: Record<string, ChannelState>): AirState {
  if (channelStates.program?.slidesSession?.rowId === row.id) return "program";
  if (channelStates.preview?.slidesSession?.rowId === row.id) return "preview";
  return null;
}

export function slidesThumbState(
  row: RowLike,
  position: number,
  channelStates: Record<string, ChannelState>,
): "live" | "cued" | null {
  const p = channelStates.program?.slidesSession;
  if (p?.rowId === row.id && p.slideIdx === position) return "live";
  const v = channelStates.preview?.slidesSession;
  if (v?.rowId === row.id && v.slideIdx === position) return "cued";
  return null;
}

export function slidesThumbMessages(
  showId: string,
  row: RowLike,
  position: number,
  target: "preview" | "program-live",
): ClientMessage[] | null {
  if (target === "program-live") return [{ type: "slides_goto", channel: "program", slideIdx: position }];
  return [{ type: "slides_take", showId, rowId: row.id, slideIdx: position, channel: "preview" }];
}

/** cue → preview, take → row.channelHint ?? "program". */
export function slidesRowTakeMessages(showId: string, row: RowLike, action: "cue" | "take"): ClientMessage[] | null {
  return [slidesRowTakeMessage(showId, row, action)];
}

export function slidesStripNotice(
  row: RowLike,
  view: SlidesRowView,
  channelStates: Record<string, ChannelState>,
): string | null {
  const atEnd = [channelStates.program, channelStates.preview].some(
    (c) => c?.slidesSession?.rowId === row.id && c.slidesSession.atEnd,
  );
  if (atEnd) return SLIDES_END_OF_DECK;
  if (view.missingDeck) return "Missing deck — restore it from Slides";
  if (view.missingSlides > 0) {
    return `${view.missingSlides} slide${view.missingSlides === 1 ? "" : "s"} no longer in the deck were skipped`;
  }
  return null;
}

export function slidesKeyChannel(channelStates: Record<string, ChannelState>): "program" | null {
  return channelStates.program?.slidesSession ? "program" : null;
}

export function slidesAdvanceMessage(delta: 1 | -1): ClientMessage | null {
  return { type: "slides_advance", channel: "program", delta };
}

/** B while keyMode is "slides". */
export function slidesBlankMessage(): ClientMessage | null {
  return { type: "slides_blank", channel: "program" };
}
