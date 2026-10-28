import { describe, expect, it } from "vitest";
import type { Deck, SlidesRowFields } from "./deck";
import { deckTextToSlides, resolveSlidesRow, slidesRowView, slideTextLines } from "./slides";

const deck = { id: "d", name: "Gloria", defaultTemplateId: "deckT", tags: [], licensing: { kind: "own" },
  createdAt: "x", slides: [
    { id: "a", data: { text: "Line A" }, label: "Response 1" },
    { id: "b", templateId: "slideT", data: { text: "Line B" } },
    { id: "c", data: { text: "Line C" } } ] } as Deck;
const row = (p: Partial<SlidesRowFields> = {}): SlidesRowFields => ({ kind: "slides", id: "r", deckId: "d", ...p });

describe("slides resolvers", () => {
  it("template precedence: slide → row → deck", () => {
    const out = resolveSlidesRow(row({ templateId: "rowT" }), deck).slides.map((s) => s.templateId);
    expect(out).toEqual(["rowT", "slideT", "rowT"]);
    expect(resolveSlidesRow(row(), deck).slides.map((s) => s.templateId)).toEqual(["deckT", "slideT", "deckT"]);
  });
  it("slideIds subset, reorder and repeat; keys are unique per position", () => {
    const s = resolveSlidesRow(row({ slideIds: ["c", "a", "a"] }), deck).slides;
    expect(s.map((x) => x.slideId)).toEqual(["c", "a", "a"]);
    expect(new Set(s.map((x) => x.key)).size).toBe(3);
    expect(s.map((x) => x.position)).toEqual([0, 1, 2]);
  });
  it("field overrides merge over slide data, per slide id", () => {
    const s = resolveSlidesRow(row({ fieldOverrides: { a: { text: "Line A2", choir: "X" } } }), deck).slides;
    expect(s[0]!.data).toEqual({ text: "Line A2", choir: "X" });
    expect(s[1]!.data).toEqual({ text: "Line B" });
  });
  it("missing slide ids are skipped and counted", () => {
    const r = resolveSlidesRow(row({ slideIds: ["a", "gone", "b"] }), deck);
    expect(r.slides.map((x) => x.slideId)).toEqual(["a", "b"]);
    expect(r.missingSlides).toBe(1);
  });
  it("view: title, detail and missing deck", () => {
    expect(slidesRowView(row(), deck)).toMatchObject({ title: "Gloria", detail: "3 slides", missingDeck: false, licensing: "own" });
    expect(slidesRowView(row({ slideIds: ["a"] }), deck).detail).toBe("1 of 3 slides");
    expect(slidesRowView(row(), null)).toMatchObject({ title: "Missing deck", detail: "Deck deleted or not synced", slides: [], missingDeck: true });
    expect(slidesRowView(row(), undefined)).toMatchObject({ title: "Slides deck", detail: "Loading…", slides: [], missingDeck: false });
    expect(slidesRowView(row({ deckId: undefined, localSlides: [{ id: "l", data: { text: "Line L" } }], templateId: "rowT" }), null))
      .toMatchObject({ title: "One-off slides", detail: "1 slide", missingDeck: false, licensing: null });
    expect(slidesRowView(row({ deckId: undefined }), null).missingDeck).toBe(true);
  });
  it("slideTextLines follows template text-field order, else non-empty values", () => {
    const tpl = { fields: [{ key: "people", type: "text", label: "P" }, { key: "leader", type: "text", label: "L" }] };
    expect(slideTextLines({ leader: "Line A", people: "Line B" }, tpl as never)).toEqual(["Line B", "Line A"]);
    expect(slideTextLines({ text: "Line A\nLine B", empty: "" })).toEqual(["Line A", "Line B"]);
  });
  it("deckTextToSlides splits on blank lines and trims", () => {
    let n = 0; const id = () => `s${++n}`;
    expect(deckTextToSlides("Line A\nLine B\n\n\nLine C\n", "text", id))
      .toEqual([{ id: "s1", data: { text: "Line A\nLine B" } }, { id: "s2", data: { text: "Line C" } }]);
    expect(deckTextToSlides("   \n", "text", id)).toEqual([]);
  });
});
