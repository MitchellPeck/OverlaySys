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
  removeAt,
  rowSlideIds,
  setDeck,
  setFieldOverride,
  setLocalSlideField,
  setRowTemplate,
  setSubset,
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
    { id: "b", templateId: "slideT", data: { text: "Line B" } },
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

  it("rowSlideIds is the subset when set, else deck order", () => {
    expect(rowSlideIds(row(), deck)).toEqual(["a", "b", "c"]);
    expect(rowSlideIds(row({ slideIds: ["c"] }), deck)).toEqual(["c"]);
  });

  it("setDeck clears slideIds, fieldOverrides and localSlides; keeps id and unknown keys", () => {
    const out = setDeck(row({ slideIds: ["a"], fieldOverrides: { a: { text: "x" } }, templateId: "rowT" }), "d2");
    expect(out).toEqual({ kind: "slides", id: "r", deckId: "d2", extra: "keep", templateId: "rowT" });
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
        { id: "n1", templateId: "slideT", data: { text: "Line B" } },
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
});
