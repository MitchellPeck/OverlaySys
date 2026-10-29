import { describe, expect, it } from "vitest";
import type { Deck, DeckMeta, SlidesRowFields } from "@overlaysys/core";
import {
  deckDefaultLabel,
  deckPickerList,
  detachConfirm,
  overrideValue,
  slideCaption,
  slideCountText,
  slideListEntries,
} from "./slidesRowModel";

const meta = (id: string, name: string, p: Partial<DeckMeta> = {}): DeckMeta => ({
  id,
  name,
  tags: [],
  slideCount: 1,
  licensing: "own",
  usedBy: 0,
  createdAt: "2026-01-01",
  ...p,
});

const deck = {
  slides: [
    { id: "a", data: { text: "Line A" }, label: "Response 1" },
    { id: "b", data: { text: "\nLine B\nmore" } },
    { id: "c", data: {} },
  ],
} as Pick<Deck, "slides">;
const row = (p: Partial<SlidesRowFields> = {}): SlidesRowFields => ({ kind: "slides", id: "r", deckId: "d", ...p });

describe("deckPickerList", () => {
  const decks = [
    meta("1", "Gloria", { updatedAt: "2026-03-01" }),
    meta("2", "Announcements", { tags: ["weekly"], createdAt: "2026-05-01" }),
    meta("3", "Creed", { updatedAt: "2026-04-01" }),
  ];
  it("recent (edited, else created) first", () => {
    expect(deckPickerList(decks, "").map((d) => d.id)).toEqual(["2", "3", "1"]);
  });
  it("searches name and tags, case-insensitive", () => {
    expect(deckPickerList(decks, "GLO").map((d) => d.id)).toEqual(["1"]);
    expect(deckPickerList(decks, "week").map((d) => d.id)).toEqual(["2"]);
  });
});

describe("slideListEntries", () => {
  it("all slides in deck order when there is no subset", () => {
    expect(slideListEntries(row(), deck).map((e) => [e.kind, e.slideId])).toEqual([
      ["in", "a"],
      ["in", "b"],
      ["in", "c"],
    ]);
  });
  it("a repeat shows twice; left-out slides follow; stale ids stay", () => {
    const e = slideListEntries(row({ slideIds: ["b", "gone", "b"] }), deck);
    expect(e.map((x) => [x.kind, x.slideId])).toEqual([
      ["in", "b"],
      ["in", "gone"],
      ["in", "b"],
      ["out", "a"],
      ["out", "c"],
    ]);
    expect(e[1]).toMatchObject({ slide: null, position: 1 });
    expect(e[2]).toMatchObject({ repeat: true, position: 2 });
  });
});

describe("copy helpers", () => {
  it("slideCountText", () => {
    expect(slideCountText(2, 3)).toBe("2 of 3 slides");
    expect(slideCountText(1, 1)).toBe("1 of 1 slide");
  });
  it("slideCaption: label, first text line, else Slide n", () => {
    expect(slideCaption(deck.slides[0]!, 0)).toBe("Response 1");
    expect(slideCaption(deck.slides[1]!, 1)).toBe("Line B");
    expect(slideCaption(deck.slides[2]!, 2)).toBe("Slide 3");
    expect(slideCaption(null, 0)).toBe("Slide no longer in the deck");
  });
  it("deckDefaultLabel", () => {
    expect(deckDefaultLabel("Lyrics")).toBe("Deck default (Lyrics)");
  });
  it("detachConfirm copy", () => {
    expect(detachConfirm("Gloria")).toEqual({
      title: "Detach from deck?",
      message: 'This show gets its own copy of the slides. Later edits to "Gloria" won\'t change it.',
      confirmLabel: "Detach",
    });
  });
  it("overrideValue drops edits equal to the deck text", () => {
    expect(overrideValue("x", "x")).toBeUndefined();
    expect(overrideValue("", undefined)).toBeUndefined();
    expect(overrideValue("y", "x")).toBe("y");
  });
});
