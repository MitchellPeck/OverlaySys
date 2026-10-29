import { describe, expect, it } from "vitest";
import type { Deck, SlidesRowFields } from "./deck";
import { resolveSlidesRow } from "./slides";
import {
  addLocalSlide,
  addRepeat,
  detachSlidesRow,
  moveAt,
  newOneOffSlidesRow,
  newSlidesRow,
  pasteLocalSlides,
  removeAt,
  removeLocalSlide,
  saveRowToLibrary,
  rowSlideIds,
  setDeck,
  setFieldOverride,
  setLocalSlideField,
  setRowTemplate,
  setSubset,
  splitPastedSlides,
  useAllSlides,
} from "./slidesRowOps";

const deck = {
  id: "d",
  name: "Gloria",
  defaultTemplateId: "deckT",
  tags: [],
  licensing: { kind: "own" },
  createdAt: "x",
  slides: [
    { id: "a", data: { text: "Line A" }, label: "Response 1" },
    { id: "b", templateId: "slideT", data: { text: "Line B" }, futureSlideKey: "keep" },
    { id: "c", data: { text: "Line C" } },
  ],
} as Deck;
type Row = SlidesRowFields & { extra?: string };
const row = (p: Partial<Row> = {}): Row => ({ kind: "slides", id: "r", deckId: "d", extra: "keep", ...p });

describe("slidesRowOps", () => {
  it("newSlidesRow points at the deck with nothing else", () => {
    expect(newSlidesRow("r1", "d")).toEqual({ kind: "slides", id: "r1", deckId: "d" });
  });

  it("newOneOffSlidesRow has one empty local slide and a design", () => {
    expect(newOneOffSlidesRow("r1", "t", "s1")).toEqual({
      kind: "slides",
      id: "r1",
      templateId: "t",
      localSlides: [{ id: "s1", data: {} }],
    });
  });

  it("newOneOffSlidesRow seeds \"\" for each text field so the design's sample text never airs", () => {
    expect(newOneOffSlidesRow("r1", "t", "s1", ["header", "subtitle"]).localSlides).toEqual([
      { id: "s1", data: { header: "", subtitle: "" } },
    ]);
  });

  it("rowSlideIds is the subset when set, else deck order", () => {
    expect(rowSlideIds(row(), deck)).toEqual(["a", "b", "c"]);
    expect(rowSlideIds(row({ slideIds: ["c"] }), deck)).toEqual(["c"]);
  });

  it("setDeck clears slideIds, fieldOverrides and localSlides; keeps id and unknown keys", () => {
    const out = setDeck(row({ slideIds: ["a"], fieldOverrides: { a: { text: "x" } }, templateId: "rowT" }), "d2");
    expect(out).toEqual({ kind: "slides", id: "r", deckId: "d2", extra: "keep", templateId: "rowT" });
  });

  it("setDeck keeps the row's stage screen layouts", () => {
    const stageLayouts = { band: "lyrics-big" };
    expect(setDeck(row({ stageLayouts, slideIds: ["a"] }), "d2").stageLayouts).toEqual(stageLayouts);
  });

  it("detachSlidesRow keeps the row's stage screen layouts", () => {
    const stageLayouts = { band: "lyrics-big", confidence: "clock" };
    expect(detachSlidesRow(row({ stageLayouts }), deck, () => "x").stageLayouts).toEqual(stageLayouts);
  });

  it("useAllSlides removes slideIds", () => {
    expect(useAllSlides(row({ slideIds: ["a"] }))).toEqual(row());
  });

  it("setSubset back to full order clears slideIds", () => {
    expect(setSubset(row({ slideIds: ["a"] }), deck, ["a", "b", "c"])).toEqual(row());
    expect(setSubset(row(), deck, ["c", "a"]).slideIds).toEqual(["c", "a"]);
    expect(setSubset(row(), deck, []).slideIds).toEqual([]);
  });

  it("addRepeat inserts the same id after position", () => {
    expect(addRepeat(row(), deck, 1).slideIds).toEqual(["a", "b", "b", "c"]);
    expect(addRepeat(row({ slideIds: ["c", "a"] }), deck, 0).slideIds).toEqual(["c", "c", "a"]);
    expect(addRepeat(row(), deck, 9)).toEqual(row());
  });

  it("removeAt removes one position; removing a repeat can collapse to the full order", () => {
    expect(removeAt(row(), deck, 0).slideIds).toEqual(["b", "c"]);
    expect(removeAt(row({ slideIds: ["a", "b", "b", "c"] }), deck, 2)).toEqual(row());
  });

  it("moveAt reorders positions", () => {
    expect(moveAt(row(), deck, 2, 0).slideIds).toEqual(["c", "a", "b"]);
    expect(moveAt(row({ slideIds: ["c", "a", "b"] }), deck, 0, 2)).toEqual(row());
    expect(moveAt(row(), deck, 0, 5)).toEqual(row());
  });

  it("positions count stale ids so a missing slide can be removed", () => {
    expect(removeAt(row({ slideIds: ["a", "gone", "b"] }), deck, 1).slideIds).toEqual(["a", "b"]);
  });

  it("setRowTemplate sets and clears the row override", () => {
    expect(setRowTemplate(row(), "rowT").templateId).toBe("rowT");
    expect(setRowTemplate(row({ templateId: "rowT" }), undefined)).toEqual(row());
    expect(setRowTemplate(row({ templateId: "rowT" }), "")).toEqual(row());
  });

  it("setFieldOverride sets one field per slide", () => {
    const out = setFieldOverride(row({ fieldOverrides: { a: { text: "x" } } }), "a", "choir", "Y");
    expect(out.fieldOverrides).toEqual({ a: { text: "x", choir: "Y" } });
  });

  it("setFieldOverride with undefined prunes the empty slide entry", () => {
    const out = setFieldOverride(row({ fieldOverrides: { a: { text: "x" }, b: { text: "y" } } }), "a", "text", undefined);
    expect(out.fieldOverrides).toEqual({ b: { text: "y" } });
    expect(setFieldOverride(row({ fieldOverrides: { a: { text: "x" } } }), "a", "text", undefined)).toEqual(row());
  });

  it("detach bakes overrides and the effective template and keeps id, sourceRef, sectionId", () => {
    const sourceRef = { provider: "pco" as const, serviceTypeId: "st", planId: "p", itemId: "i" };
    let n = 0;
    const src = row({ slideIds: ["b", "a", "a"], fieldOverrides: { a: { text: "Line A2" } }, sectionId: "sec", sourceRef });
    const out = detachSlidesRow(src, deck, () => `n${++n}`);
    expect(out).toEqual({
      kind: "slides",
      id: "r",
      extra: "keep",
      sectionId: "sec",
      sourceRef,
      templateId: "deckT",
      localSlides: [
        { id: "n1", templateId: "slideT", data: { text: "Line B" }, futureSlideKey: "keep" },
        { id: "n2", label: "Response 1", data: { text: "Line A2" } },
        { id: "n3", label: "Response 1", data: { text: "Line A2" } },
      ],
    });
    // Resolves to the same slides and designs as before.
    const before = resolveSlidesRow(src, deck);
    const after = resolveSlidesRow(out, null);
    expect(after.slides.map((s) => [s.templateId, s.data])).toEqual(before.slides.map((s) => [s.templateId, s.data]));
  });

  it("detach keeps a row design override over the deck default", () => {
    expect(detachSlidesRow(row({ templateId: "rowT" }), deck, () => "x").templateId).toBe("rowT");
  });

  it("addLocalSlide appends to localSlides (and to a subset when one is set)", () => {
    const one = newOneOffSlidesRow("r", "t", "s1");
    expect(addLocalSlide(one, "s2").localSlides).toEqual([
      { id: "s1", data: {} },
      { id: "s2", data: {} },
    ]);
    expect(addLocalSlide({ ...one, slideIds: ["s1"] }, "s2").slideIds).toEqual(["s1", "s2"]);
  });

  it("setLocalSlideField edits local slide data; undefined removes the key", () => {
    const one = newOneOffSlidesRow("r", "t", "s1");
    const a = setLocalSlideField(one, "s1", "text", "Hello");
    expect(a.localSlides).toEqual([{ id: "s1", data: { text: "Hello" } }]);
    expect(setLocalSlideField(a, "s1", "text", undefined).localSlides).toEqual([{ id: "s1", data: {} }]);
  });

  it("setLocalSlideField keeps a cleared field as \"\" (airs blank, not sample text)", () => {
    const a = setLocalSlideField(newOneOffSlidesRow("r", "t", "s1", ["text"]), "s1", "text", "Hello");
    expect(setLocalSlideField(a, "s1", "text", "").localSlides).toEqual([{ id: "s1", data: { text: "" } }]);
  });

  it("setFieldOverride keeps an explicit \"\" override", () => {
    expect(setFieldOverride(row(), "a", "text", "").fieldOverrides).toEqual({ a: { text: "" } });
  });

  it("addLocalSlide seeds \"\" for each text field", () => {
    const one = newOneOffSlidesRow("r", "t", "s1", ["text"]);
    expect(addLocalSlide(one, "s2", ["text"]).localSlides?.[1]).toEqual({ id: "s2", data: { text: "" } });
  });

  it("removeLocalSlide deletes the slide and its subset positions; unknown keys kept", () => {
    const one = { ...addLocalSlide(newOneOffSlidesRow("r", "t", "s1"), "s2"), slideIds: ["s1", "s2", "s1"], extra: "keep" };
    const out = removeLocalSlide(one, "s1");
    expect(out.localSlides).toEqual([{ id: "s2", data: {} }]);
    expect(out.slideIds).toEqual(["s2"]);
    expect(out.extra).toBe("keep");
  });

  describe("saveRowToLibrary", () => {
    const oneOff = (): Row => ({
      kind: "slides",
      id: "r",
      extra: "keep",
      sectionId: "sec",
      stageLayouts: { band: "lay" },
      templateId: "rowT",
      slideIds: ["s2", "s1", "s2"],
      localSlides: [
        { id: "s1", data: { text: "Placeholder one" }, label: "Call" },
        { id: "s2", templateId: "ownT", data: { text: "" }, futureSlideKey: "keep" } as never,
      ],
    });
    const a = { deckId: "deck-1", name: "Placeholder deck", licensing: { kind: "own" } as const, now: "2026-10-28T00:00:00.000Z" };

    it("saveRowToLibrary keeps slide ids so nothing re-keys", () => {
      const { deck: d, row: out } = saveRowToLibrary(oneOff(), a);
      expect(d).toEqual({
        id: "deck-1",
        name: "Placeholder deck",
        tags: [],
        defaultTemplateId: "rowT",
        licensing: { kind: "own" },
        slides: oneOff().localSlides,
        createdAt: a.now,
      });
      expect(out).toEqual({
        kind: "slides",
        id: "r",
        extra: "keep",
        sectionId: "sec",
        stageLayouts: { band: "lay" },
        slideIds: ["s2", "s1", "s2"],
        deckId: "deck-1",
      });
    });

    it("the row afterwards resolves to the same slides through the deck", () => {
      const before = resolveSlidesRow(oneOff(), null);
      const { deck: d, row: out } = saveRowToLibrary(oneOff(), a);
      const after = resolveSlidesRow(out, d);
      expect(after).toEqual(before);
    });

    it("keeps this show's text edits on the row", () => {
      const src = { ...oneOff(), fieldOverrides: { s1: { text: "Edited" } } };
      const { deck: d, row: out } = saveRowToLibrary(src, a);
      expect(out.fieldOverrides).toEqual({ s1: { text: "Edited" } });
      expect(resolveSlidesRow(out, d)).toEqual(resolveSlidesRow(src, null));
    });

    it("trims the name and drops a blank CCLI number", () => {
      const { deck: d } = saveRowToLibrary(oneOff(), { ...a, name: "  Name  ", licensing: { kind: "ccli", ccliNumber: " " } });
      expect(d.name).toBe("Name");
      expect(d.licensing).toEqual({ kind: "ccli" });
    });
  });

  describe("paste text", () => {
    it("splitPastedSlides splits on blank lines and trims", () => {
      expect(splitPastedSlides("Line A\nLine B\n\n \n\nLine C  \r\n\r\nLine D\n")).toEqual(["Line A\nLine B", "Line C", "Line D"]);
      expect(splitPastedSlides("  \n\n ")).toEqual([]);
    });

    it("fills the lone empty slide first (same id) and appends the rest with \"\" for other fields", () => {
      let n = 0;
      const start = newOneOffSlidesRow("r", "t", "s1", ["header", "text"]);
      const out = pasteLocalSlides(start, ["P1", "P2"], { newId: () => `n${++n}`, fieldKeys: ["header", "text"], targetKey: "text" });
      expect(out.localSlides).toEqual([
        { id: "s1", data: { header: "", text: "P1" } },
        { id: "n1", data: { header: "", text: "P2" } },
      ]);
    });

    it("appends after slides that have text, and to the subset when one is set", () => {
      const start = { ...setLocalSlideField(newOneOffSlidesRow("r", "t", "s1", ["text"]), "s1", "text", "Kept"), slideIds: ["s1"] };
      const out = pasteLocalSlides(start, ["P1"], { newId: () => "n1", fieldKeys: ["text"], targetKey: "text" });
      expect(out.localSlides?.map((s) => s.id)).toEqual(["s1", "n1"]);
      expect(out.localSlides?.[0]?.data).toEqual({ text: "Kept" });
      expect(out.slideIds).toEqual(["s1", "n1"]);
    });

    it("no chunks: row unchanged", () => {
      const start = newOneOffSlidesRow("r", "t", "s1", ["text"]);
      expect(pasteLocalSlides(start, [], { newId: () => "x", fieldKeys: ["text"], targetKey: "text" })).toBe(start);
    });
  });
});
