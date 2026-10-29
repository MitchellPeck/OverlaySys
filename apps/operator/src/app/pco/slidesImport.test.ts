import { describe, expect, it } from "vitest";
import type { DeckMeta, DeckSuggestion } from "@overlaysys/core";
import { initialSlidesChoice, rememberLabel, slidesImportConfig } from "./slidesImport";

const decks = [{ id: "d1", name: "Deck One" }] as DeckMeta[];
const remembered: DeckSuggestion = {
  deckId: "d1",
  deckName: "Deck One",
  via: "remembered",
  mappingId: "m1",
  templateId: "t9",
};

describe("initialSlidesChoice", () => {
  it("preselects a remembered, existing deck with its template", () => {
    expect(initialSlidesChoice(remembered, decks)).toEqual({
      kind: "slides",
      deckId: "d1",
      templateId: "t9",
      remember: true,
    });
  });
  it("omits templateId when the mapping has none", () => {
    const { templateId: _t, ...noTpl } = remembered;
    expect(initialSlidesChoice(noTpl, decks)).toEqual({ kind: "slides", deckId: "d1", remember: true });
  });
  it("returns null when the remembered deck is gone", () => {
    expect(initialSlidesChoice({ ...remembered, deckId: "gone" }, decks)).toBeNull();
  });
  it("returns null for a name-only suggestion", () => {
    expect(initialSlidesChoice({ ...remembered, via: "name" }, decks)).toBeNull();
  });
  it("returns null with no suggestion", () => {
    expect(initialSlidesChoice(undefined, decks)).toBeNull();
  });
});

describe("rememberLabel", () => {
  it("uses the title for a plain item", () => {
    expect(rememberLabel({ title: "Item A", song: undefined })).toBe(
      'Remember for items titled "Item A"',
    );
  });
  it("names the song for a PCO song item", () => {
    expect(rememberLabel({ title: "Item A", song: { id: "s1", title: "T" } as never })).toBe(
      "Remember for this Planning Center song",
    );
  });
});

describe("slidesImportConfig", () => {
  it("passes the remembered template back only for the remembered deck", () => {
    expect(slidesImportConfig("i1", { deckId: "d1", remember: true }, remembered)).toEqual({
      itemId: "i1",
      kind: "slides",
      deckId: "d1",
      remember: true,
      templateId: "t9",
    });
    expect(slidesImportConfig("i1", { deckId: "d2", remember: false }, remembered)).toEqual({
      itemId: "i1",
      kind: "slides",
      deckId: "d2",
      remember: false,
    });
  });
});
