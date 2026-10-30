import type { ChannelState, Deck, SlidesRowFields, SlidesRowView } from "@overlaysys/core";
import { SLIDES_END_OF_DECK, isMediaOnlyDeck, slidesRowView } from "@overlaysys/core";
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

/**
 * The output this slides row is on air on: program first, then the row's
 * own routed output (channelHint), then any other non-preview output whose
 * session is this row's. Preview never counts. Null when not on air.
 */
export function slidesLiveChannel(row: RowLike, channelStates: Record<string, ChannelState | undefined>): string | null {
  const hint = (row as { channelHint?: string }).channelHint;
  const order = ["program", ...(hint && hint !== "program" ? [hint] : []), ...Object.keys(channelStates)];
  for (const ch of order) {
    if (ch === "preview") continue;
    if (channelStates[ch]?.slidesSession?.rowId === row.id) return ch;
  }
  return null;
}

/** ON AIR on any non-preview output reads "program" (as songs routed elsewhere do); else cued on preview. */
export function slidesAirState(row: RowLike, channelStates: Record<string, ChannelState>): AirState {
  if (slidesLiveChannel(row, channelStates)) return "program";
  if (channelStates.preview?.slidesSession?.rowId === row.id) return "preview";
  return null;
}

export function slidesThumbState(
  row: RowLike,
  position: number,
  channelStates: Record<string, ChannelState>,
): "live" | "cued" | null {
  const ch = slidesLiveChannel(row, channelStates);
  const p = ch ? channelStates[ch]?.slidesSession : undefined;
  if (p && p.slideIdx === position) return "live";
  const v = channelStates.preview?.slidesSession;
  if (v?.rowId === row.id && v.slideIdx === position) return "cued";
  return null;
}

/** A thumbnail click: jump the live session on its own output, else cue that slide on preview. */
export function slidesThumbMessages(
  showId: string,
  row: RowLike,
  position: number,
  target: "preview" | "program-live",
  liveChannel = "program",
): ClientMessage[] | null {
  if (target === "program-live") return [{ type: "slides_goto", channel: liveChannel, slideIdx: position }];
  return [{ type: "slides_take", showId, rowId: row.id, slideIdx: position, channel: "preview" }];
}

/** cue → preview, take → row.channelHint ?? "program". */
export function slidesRowTakeMessages(showId: string, row: RowLike, action: "cue" | "take"): ClientMessage[] | null {
  return [slidesRowTakeMessage(showId, row, action)];
}

/** Whether a deck moves on by itself: a deck hold, any slide hold, a live folder, or videos that advance when they end. */
export function deckAutoAdvances(deck: Deck): boolean {
  if (deck.defaultHoldSec !== undefined || deck.liveFolderId) return true;
  if (deck.slides.some((s) => s.holdSec !== undefined)) return true;
  return isMediaOnlyDeck(deck) && deck.slides.some((s) => s.media?.mediaType === "video" && s.advanceOnEnd !== false);
}

/**
 * The Live timing note for a slides row on air (never preview): "auto · loops"
 * or "auto", plus when the next slide comes (server clock). Null for a manual deck.
 */
export function slidesAutoInfo(
  row: RowLike,
  channelStates: Record<string, ChannelState | undefined>,
  deck: Deck | null | undefined,
): { text: string; nextAdvanceAt?: number } | null {
  const ch = slidesLiveChannel(row, channelStates);
  const s = ch ? channelStates[ch]?.slidesSession : undefined;
  if (!s) return null;
  const auto = s.nextAdvanceAt !== undefined || (!!deck && !deck.deletedAt && deckAutoAdvances(deck));
  if (!auto) return null;
  return { text: s.loops ? "auto · loops" : "auto", ...(s.nextAdvanceAt !== undefined ? { nextAdvanceAt: s.nextAdvanceAt } : {}) };
}

/** Whole seconds until `nextAdvanceAt` (server clock), rounded up; `serverOffsetMs` = server − local. Never negative. */
export function slidesCountdownSec(nextAdvanceAt: number, nowMs: number, serverOffsetMs: number): number {
  return Math.max(0, Math.ceil((nextAdvanceAt - (nowMs + serverOffsetMs)) / 1000));
}

export function slidesStripNotice(
  row: RowLike,
  view: SlidesRowView,
  channelStates: Record<string, ChannelState>,
): string | null {
  const atEnd = Object.values(channelStates).some(
    (c) => c?.slidesSession?.rowId === row.id && c.slidesSession.atEnd,
  );
  if (atEnd) return SLIDES_END_OF_DECK;
  if (view.missingDeck) return "Missing deck — restore it from Slides";
  if (view.missingSlides > 0) {
    return `${view.missingSlides} slide${view.missingSlides === 1 ? "" : "s"} no longer in the deck were skipped`;
  }
  return null;
}

/**
 * The output Space / Shift+Space / B drive in slides key mode: a program
 * slides session, else one on another non-preview output (a row routed
 * there). Preview never drives keys.
 */
export function slidesKeyChannel(channelStates: Record<string, ChannelState | undefined>): string | null {
  if (channelStates.program?.slidesSession) return "program";
  for (const [ch, st] of Object.entries(channelStates)) {
    if (ch !== "preview" && st?.slidesSession) return ch;
  }
  return null;
}

export function slidesAdvanceMessage(delta: 1 | -1, channel = "program"): ClientMessage | null {
  return { type: "slides_advance", channel, delta };
}

/** B while keyMode is "slides". */
export function slidesBlankMessage(channel = "program"): ClientMessage | null {
  return { type: "slides_blank", channel };
}

/**
 * Header Cue / Take for a slides row: enabled only when the deck is loaded and
 * has slides (same rule as the rundown buttons and the Enter / Space keys).
 * A missing deck says so in the tooltip.
 */
export const MISSING_DECK_TITLE = "Missing deck — restore it from Slides";
export function slidesControlState(
  row: RowLike,
  c: { deckCache: Record<string, Deck>; deckNotFound?: Record<string, true> },
): { enabled: boolean; title?: string } {
  const deckId = (row as { deckId?: string }).deckId;
  const view = slidesRowViewFor(row, deckId ? (c.deckNotFound?.[deckId] ? null : c.deckCache[deckId]) : null);
  if (view && !view.missingDeck && view.slides.length > 0) return { enabled: true };
  return view?.missingDeck ? { enabled: false, title: MISSING_DECK_TITLE } : { enabled: false };
}
