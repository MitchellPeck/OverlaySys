import { describe, expect, it } from "vitest";
import type { ChannelState, Deck } from "@overlaysys/core";
import { SLIDES_END_OF_DECK } from "@overlaysys/core";
import type { RowLike } from "./rowLike";
import * as a from "./slidesRowView";

const row: RowLike = { kind: "slides", id: "r1", deckId: "d1" };
const session = (rowId: string, o: object = {}) => ({
  rowId,
  title: "Deck A",
  slideIdx: 1,
  slideCount: 3,
  lines: [],
  blanked: false,
  atEnd: false,
  ...o,
});
const st = (o: object): ChannelState => o as ChannelState;
const deck = (o: Partial<Deck> = {}): Deck =>
  ({
    id: "d1",
    name: "Deck A",
    tags: [],
    defaultTemplateId: "t1",
    licensing: { kind: "own" },
    slides: [
      { id: "a", data: { text: "Line A" } },
      { id: "b", data: { text: "Line B" } },
    ],
    createdAt: "2026-01-01",
    ...o,
  }) as Deck;

describe("slides adapter", () => {
  it("is enabled", () => {
    expect(a.slidesAddItemEnabled).toBe(true);
  });

  it("slidesRowViewFor resolves a deck and ignores non-slides rows", () => {
    expect(a.slidesRowViewFor(row, deck())?.title).toBe("Deck A");
    expect(a.slidesRowViewFor({ kind: "song", id: "x" }, undefined)).toBeNull();
  });

  it("a tombstoned deck is treated as missing", () => {
    expect(a.slidesRowViewFor(row, deck({ deletedAt: "2026-02-01" }))?.missingDeck).toBe(true);
  });

  it("slidesAirState: program vs preview", () => {
    expect(a.slidesAirState(row, { program: st({ slidesSession: session("r1") }) })).toBe("program");
    expect(a.slidesAirState(row, { preview: st({ slidesSession: session("r1") }) })).toBe("preview");
    expect(a.slidesAirState(row, { program: st({ slidesSession: session("r2") }) })).toBeNull();
  });

  it("slidesThumbState: live on program, cued on preview", () => {
    const states = {
      program: st({ slidesSession: session("r1", { slideIdx: 1 }) }),
      preview: st({ slidesSession: session("r1", { slideIdx: 2 }) }),
    };
    expect(a.slidesThumbState(row, 1, states)).toBe("live");
    expect(a.slidesThumbState(row, 2, states)).toBe("cued");
    expect(a.slidesThumbState(row, 0, states)).toBeNull();
  });

  it("slidesThumbMessages covers both targets", () => {
    expect(a.slidesThumbMessages("s", row, 2, "program-live")).toEqual([{ type: "slides_goto", channel: "program", slideIdx: 2 }]);
    expect(a.slidesThumbMessages("s", row, 2, "preview")).toEqual([
      { type: "slides_take", showId: "s", rowId: "r1", slideIdx: 2, channel: "preview" },
    ]);
  });

  it("slidesRowTakeMessages cue and take", () => {
    expect(a.slidesRowTakeMessages("s", row, "cue")).toEqual([{ type: "slides_take", showId: "s", rowId: "r1", channel: "preview" }]);
    expect(a.slidesRowTakeMessages("s", row, "take")).toEqual([{ type: "slides_take", showId: "s", rowId: "r1", channel: "program" }]);
  });

  it("slidesStripNotice: end of deck, missing deck, missing slides, none", () => {
    const view = a.slidesRowViewFor(row, deck())!;
    expect(a.slidesStripNotice(row, view, { program: st({ slidesSession: session("r1", { atEnd: true }) }) })).toBe(SLIDES_END_OF_DECK);
    expect(a.slidesStripNotice(row, a.slidesRowViewFor(row, null)!, {})).toBe("Missing deck — restore it from Slides");
    const two = { kind: "slides", id: "r1", deckId: "d1", slideIds: ["a", "gone", "gone2"] } as RowLike;
    expect(a.slidesStripNotice(two, a.slidesRowViewFor(two, deck())!, {})).toBe("2 slides no longer in the deck were skipped");
    const one = { kind: "slides", id: "r1", deckId: "d1", slideIds: ["a", "gone"] } as RowLike;
    expect(a.slidesStripNotice(one, a.slidesRowViewFor(one, deck())!, {})).toBe("1 slide no longer in the deck were skipped");
    expect(a.slidesStripNotice(row, view, {})).toBeNull();
  });

  it("key helpers", () => {
    expect(a.slidesKeyChannel({})).toBeNull();
    expect(a.slidesKeyChannel({ program: st({ slidesSession: session("r1") }) })).toBe("program");
    expect(a.slidesAdvanceMessage(-1)).toEqual({ type: "slides_advance", channel: "program", delta: -1 });
    expect(a.slidesBlankMessage()).toEqual({ type: "slides_blank", channel: "program" });
  });
});
