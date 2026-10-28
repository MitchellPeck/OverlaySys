import type { ChannelState, Deck, SlidesRowView } from "@overlaysys/core";
import type { ClientMessage } from "@overlaysys/ws-protocol";
import type { RowLike } from "./rowLike";
import type { AirState } from "./rowAirState";

/**
 * Slides adapter (contracts §9). Created with stub bodies by P2a.2; plan 3
 * (P3.13) replaces the bodies and keeps every signature. Live and the show
 * editor reach slides rows only through this file.
 */

/** Whether the show editor's "+ Add item" offers Slides. */
export const slidesAddItemEnabled = false;

const EMPTY_DECKS: Record<string, Deck> = Object.freeze({});

/** The deck cache, keyed by deck id. */
export function useDeckCache(): Record<string, Deck> {
  return EMPTY_DECKS;
}

/** The deck a slides row points at: undefined = not loaded, null = missing. */
export function useDeckFor(_row: RowLike): Deck | null | undefined {
  return undefined;
}

export function slidesRowViewFor(_row: RowLike, _deck: Deck | null | undefined): SlidesRowView | null {
  return null;
}

export function slidesAirState(_row: RowLike, _channelStates: Record<string, ChannelState>): AirState {
  return null;
}

export function slidesThumbState(
  _row: RowLike,
  _position: number,
  _channelStates: Record<string, ChannelState>,
): "live" | "cued" | null {
  return null;
}

export function slidesThumbMessages(
  _showId: string,
  _row: RowLike,
  _position: number,
  _target: "preview" | "program-live",
): ClientMessage[] | null {
  return null;
}

/** cue → preview, take → row.channelHint ?? "program". */
export function slidesRowTakeMessages(_showId: string, _row: RowLike, _action: "cue" | "take"): ClientMessage[] | null {
  return null;
}

export function slidesStripNotice(
  _row: RowLike,
  _view: SlidesRowView,
  _channelStates: Record<string, ChannelState>,
): string | null {
  return null;
}

export function slidesKeyChannel(_channelStates: Record<string, ChannelState>): "program" | null {
  return null;
}

export function slidesAdvanceMessage(_delta: 1 | -1): ClientMessage | null {
  return null;
}

/** B while keyMode is "slides". */
export function slidesBlankMessage(): ClientMessage | null {
  return null;
}
