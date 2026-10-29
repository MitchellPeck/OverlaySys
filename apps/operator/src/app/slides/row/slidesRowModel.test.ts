import { describe, expect, it } from "vitest";
import type { Deck, DeckMeta, SlidesRowFields } from "@overlaysys/core";
import {
  canDeleteLocalSlide,
  deckDefaultLabel,
  deckPickerList,
  designMissesSlideText,
  detachConfirm,
  hiddenTextWarning,
  slideTextHidden,
  overrideValue,
  ownDesignCount,
  slideCaption,
  slideCountText,
  slideListEntries,
  suggestDeckName,
  unshownValues,
} from "./slidesRowModel";

describe("fix round 2 helpers", () => {
  const lt = [
    { key: "header", multiline: true },
    { key: "subtitle", multiline: true },
  ];
  it("slideTextHidden: text under a key the design lacks, until copied", () => {
    expect(slideTextHidden({ text: "Line A" }, lt)).toBe(true);
    expect(slideTextHidden({ subtitle: "Line D" }, lt)).toBe(false);
    expect(slideTextHidden({ text: "Line A", header: "Line A" }, lt)).toBe(false);
    expect(slideTextHidden({ text: "" }, lt)).toBe(false);
  });
  it("hiddenTextWarning copy", () => {
    expect(hiddenTextWarning(0)).toBeNull();
    expect(hiddenTextWarning(1)).toBe("1 slide's text isn't shown by this design");
    expect(hiddenTextWarning(3)).toBe("3 slides' text isn't shown by this design");
  });
});

describe("fix round 1 helpers", () => {
  it("deckDefaultLabel: no Missing-template flash while loading", () => {
    expect(deckDefaultLabel(undefined, false)).toBe("Deck default");
    expect(deckDefaultLabel(undefined, true)).toBe("Deck default (Missing template)");
  });
  it("detachConfirm warns about CCLI reporting for CCLI decks", () => {
    expect(detachConfirm("Gloria", true).message).toBe(
      'This show gets its own copy of the slides. Later edits to "Gloria" won\'t change it. CCLI usage won\'t be reported for this row after detaching.',
    );
  });
  it("overrideValue keeps \"\" when the deck never set the field", () => {
    expect(overrideValue("", undefined)).toBe("");
    expect(overrideValue("", "x")).toBe("");
    expect(overrideValue("x", "x")).toBeUndefined();
  });
  it("unshownValues lists non-empty values the design has no field for", () => {
    expect(unshownValues({ text: "Line A", header: "", note: " " }, ["header", "subtitle"])).toEqual([
      { key: "text", value: "Line A" },
    ]);
  });
  it("designMissesSlideText when no text key is shared", () => {
    const slides: { data: Record<string, string> }[] = [{ data: { text: "Line A" } }, { data: { title: "" } }];
    expect(designMissesSlideText(["header", "subtitle"], slides)).toBe(true);
    expect(designMissesSlideText(["text"], slides)).toBe(false);
    expect(designMissesSlideText(["header"], [{ data: {} }])).toBe(false);
  });
  it("ownDesignCount counts playing slides with their own design", () => {
    const d = { slides: [{ id: "a", data: {} }, { id: "b", templateId: "t", data: {} }] };
    expect(ownDesignCount({ kind: "slides", id: "r", deckId: "d" }, d)).toBe(1);
    expect(ownDesignCount({ kind: "slides", id: "r", deckId: "d", slideIds: ["a"] }, d)).toBe(0);
  });
});

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
    expect(overrideValue("y", "x")).toBe("y");
  });
});

describe("one-off slides (P3.17)", () => {
  const local = (p: Partial<SlidesRowFields> = {}): SlidesRowFields => ({
    kind: "slides",
    id: "r",
    templateId: "t",
    localSlides: [
      { id: "s1", data: { header: "", text: "  \n First line\nSecond" } },
      { id: "s2", data: { text: "Other" } },
    ],
    ...p,
  });

  it("canDeleteLocalSlide: not the last slide, and not the last one that plays", () => {
    expect(canDeleteLocalSlide(local(), "s1")).toBe(true);
    expect(canDeleteLocalSlide(local({ localSlides: [{ id: "s1", data: {} }] }), "s1")).toBe(false);
    // A subset that plays only s1 would end up empty.
    expect(canDeleteLocalSlide(local({ slideIds: ["s1", "s1"] }), "s1")).toBe(false);
    expect(canDeleteLocalSlide(local({ slideIds: ["s1", "s1"] }), "s2")).toBe(true);
    // A stale id in the subset doesn't count as something that plays.
    expect(canDeleteLocalSlide(local({ slideIds: ["s1", "gone"] }), "s1")).toBe(false);
  });

  it("suggestDeckName: first non-empty line of the first playing slide, capped; else empty", () => {
    expect(suggestDeckName(local())).toBe("First line");
    expect(suggestDeckName(local({ slideIds: ["s2"] }))).toBe("Other");
    expect(suggestDeckName(local({ localSlides: [{ id: "s1", data: { text: "" } }] }))).toBe("");
    expect(suggestDeckName(local({ localSlides: [{ id: "s1", data: { text: "x".repeat(80) } }] }))).toHaveLength(60);
  });
});
