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

describe("slides row routed to a non-program output (final-review I1)", () => {
  const routed = { kind: "slides", id: "r1", deckId: "d1", channelHint: "lyrics" } as RowLike;
  const onLyrics = { lyrics: st({ slidesSession: session("r1", { slideIdx: 1 }) }) };

  it("lights ON AIR on the output it was taken to", () => {
    expect(a.slidesLiveChannel(routed, onLyrics)).toBe("lyrics");
    expect(a.slidesAirState(routed, onLyrics)).toBe("program");
    // Program wins when the row is somehow on both.
    const both = { ...onLyrics, program: st({ slidesSession: session("r1") }) };
    expect(a.slidesLiveChannel(routed, both)).toBe("program");
    // Preview never counts as on air.
    expect(a.slidesLiveChannel(routed, { preview: st({ slidesSession: session("r1") }) })).toBeNull();
    // Another row's session on that output doesn't light this one.
    expect(a.slidesAirState(routed, { lyrics: st({ slidesSession: session("r2") }) })).toBeNull();
  });

  it("thumbs read live from that output; a click jumps there instead of starting a second session", () => {
    expect(a.slidesThumbState(routed, 1, onLyrics)).toBe("live");
    expect(a.slidesThumbState(routed, 0, onLyrics)).toBeNull();
    expect(a.slidesThumbMessages("s", routed, 2, "program-live", "lyrics")).toEqual([
      { type: "slides_goto", channel: "lyrics", slideIdx: 2 },
    ]);
  });

  it("keys drive the session on that output (Space, Shift+Space, B)", () => {
    expect(a.slidesKeyChannel(onLyrics)).toBe("lyrics");
    expect(a.slidesKeyChannel({ ...onLyrics, program: st({ slidesSession: session("r9") }) })).toBe("program");
    expect(a.slidesKeyChannel({ preview: st({ slidesSession: session("r1") }) })).toBeNull();
    expect(a.slidesAdvanceMessage(1, "lyrics")).toEqual({ type: "slides_advance", channel: "lyrics", delta: 1 });
    expect(a.slidesBlankMessage("lyrics")).toEqual({ type: "slides_blank", channel: "lyrics" });
  });

  it("End of deck shows for a session on that output", () => {
    const view = a.slidesRowViewFor(routed, deck())!;
    expect(a.slidesStripNotice(routed, view, { lyrics: st({ slidesSession: session("r1", { atEnd: true }) }) })).toBe(SLIDES_END_OF_DECK);
  });
});

describe("auto-advance on Live", () => {
  const timed = deck({ defaultHoldSec: 8 });
  it('slidesRowView shows "auto · loops" when the summary loops', () => {
    const cs = { program: st({ slidesSession: session("r1", { loops: true, nextAdvanceAt: 10_000 }) }) };
    expect(a.slidesAutoInfo(row, cs, timed)).toEqual({ text: "auto · loops", nextAdvanceAt: 10_000 });
  });
  it('"auto" when it does not loop; nothing for a manual deck or on preview only', () => {
    expect(a.slidesAutoInfo(row, { program: st({ slidesSession: session("r1", { loops: false }) }) }, timed)).toEqual({ text: "auto" });
    expect(a.slidesAutoInfo(row, { program: st({ slidesSession: session("r1") }) }, deck())).toBeNull();
    expect(a.slidesAutoInfo(row, { preview: st({ slidesSession: session("r1", { nextAdvanceAt: 1 }) }) }, timed)).toBeNull();
  });
  it("a running timer counts as auto even before the deck has loaded", () => {
    const cs = { program: st({ slidesSession: session("r1", { nextAdvanceAt: 5 }) }) };
    expect(a.slidesAutoInfo(row, cs, undefined)?.text).toBe("auto");
  });
  it("countdown seconds from nextAdvanceAt with a server offset", () => {
    // Server clock = local + offset: local 1000 + 2000 = 3000 on the server; 4.2 s left → 5.
    expect(a.slidesCountdownSec(7_200, 1_000, 2_000)).toBe(5);
    expect(a.slidesCountdownSec(7_000, 1_000, 2_000)).toBe(4);
    expect(a.slidesCountdownSec(2_000, 1_000, 2_000)).toBe(0);
  });
});

describe("live-folder decks on Live", () => {
  const folderDeck = deck({ slides: [], liveFolderId: "f1", folderOrder: [{ file: "b.png", holdSec: 3 }], defaultHoldSec: 8, loop: true });
  const file = (name: string, mediaType: "image" | "video" = "image") => ({ name, mediaType, size: 1, mtimeMs: 1 });
  it("slides come from the folder's files in play order, with their media", () => {
    const v = a.slidesRowViewFor(row, folderDeck, { f1: { files: [file("a.png"), file("b.png"), file("c.mp4", "video")], configured: true } })!;
    expect(v.slides.map((s) => s.label)).toEqual(["b.png", "a.png", "c.mp4"]);
    expect(v.slides.map((s) => s.position)).toEqual([0, 1, 2]);
    expect(v.slides[2]!.media).toEqual({ assetUrl: "/media-folders/f1/c.mp4", mediaType: "video" });
    expect(v.detail).toBe("3 graphics");
    expect(v.blockedReason).toBeUndefined();
    expect(a.slidesControlState({ ...row }, { deckCache: { d1: folderDeck }, liveFolderFiles: { f1: { files: [file("a.png")], configured: true } } })).toEqual({ enabled: true });
  });
  it("an empty folder: no slides, with a plain reason", () => {
    const v = a.slidesRowViewFor(row, folderDeck, { f1: { files: [], configured: true } })!;
    expect(v.slides).toEqual([]);
    expect(v.blockedReason).toBe("This folder has no photos or videos yet.");
    expect(a.slidesControlState(row, { deckCache: { d1: folderDeck }, liveFolderFiles: { f1: { files: [], configured: true } } })).toEqual({
      enabled: false,
      title: "This folder has no photos or videos yet.",
    });
  });
  it("a folder not set up on this computer: no slides, says where the graphics are", () => {
    const v = a.slidesRowViewFor(row, folderDeck, { f1: { files: [], configured: false } })!;
    expect(v.slides).toEqual([]);
    expect(v.blockedReason).toBe("These graphics are on the show computer.");
  });
  it("still loading the folder: no slides, no reason yet", () => {
    const v = a.slidesRowViewFor(row, folderDeck, {})!;
    expect(v.slides).toEqual([]);
    expect(v.detail).toBe("Loading…");
    expect(v.blockedReason).toBeUndefined();
  });
  it("the strip notice gives the reason", () => {
    const v = a.slidesRowViewFor(row, folderDeck, { f1: { files: [], configured: true } })!;
    expect(a.slidesStripNotice(row, v, {})).toBe("This folder has no photos or videos yet.");
  });
});
