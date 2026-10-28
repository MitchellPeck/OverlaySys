import { describe, expect, it } from "vitest";
import type { SlidesRowFields } from "./deck";
import {
  carryOverSlidesRow,
  findMapping,
  mappingKeysFor,
  normalizePcoTitle,
  suggestDeck,
} from "./slidesMapping";

describe("slidesMapping", () => {
  it("normalizePcoTitle folds case, punctuation, quotes, dashes, diacritics and spaces", () => {
    expect(normalizePcoTitle("  Gloria  Patri! ")).toBe("gloria patri");
    expect(normalizePcoTitle("GLORIA – PATRI")).toBe("gloria patri");
    expect(normalizePcoTitle("“Doxology”")).toBe("doxology");
    expect(normalizePcoTitle("Créed")).toBe("creed");
  });
  it("normalizePcoTitle keeps numbers", () => {
    expect(normalizePcoTitle("Psalm 23")).not.toBe(normalizePcoTitle("Psalm 100"));
  });
  it("mappingKeysFor gives a song key only for linked songs", () => {
    expect(mappingKeysFor({ title: "Gloria Patri", song: { id: "123" } as never })).toEqual({
      songKey: "pcoSong:123",
      titleKey: "title:gloria patri",
    });
    expect(mappingKeysFor({ title: "Welcome" } as never).songKey).toBeNull();
  });
  it("findMapping: the song key beats the title key; tombstones ignored", () => {
    const m = (key: string, deckId: string, deletedAt?: string) => ({
      id: key,
      key,
      kind: "slides" as const,
      deckId,
      updatedAt: "t",
      ...(deletedAt ? { deletedAt } : {}),
    });
    const item = { title: "Gloria Patri (retitled)", song: { id: "123" } } as never;
    expect(
      findMapping(item, [m("title:gloria patri retitled", "T"), m("pcoSong:123", "S")])!.deckId,
    ).toBe("S");
    expect(findMapping(item, [m("pcoSong:123", "S", "2026-10-01")])).toBeNull();
  });
  it("suggestDeck: remembered, then exact name, else null", () => {
    const decks = [
      { id: "d1", name: "Gloria Patri" },
      { id: "d2", name: "Doxology" },
    ];
    expect(suggestDeck({ title: "gloria patri" } as never, [], decks)).toMatchObject({
      deckId: "d1",
      via: "name",
    });
    expect(suggestDeck({ title: "Opening" } as never, [], decks)).toBeNull();
    const mapping = {
      id: "title:opening",
      key: "title:opening",
      kind: "slides" as const,
      deckId: "d2",
      updatedAt: "t",
    };
    expect(suggestDeck({ title: "Opening" } as never, [mapping], decks)).toMatchObject({
      deckId: "d2",
      via: "remembered",
      mappingId: "title:opening",
    });
  });
  it("suggestDeck ignores a deleted deck", () => {
    const mapping = {
      id: "title:gloria patri",
      key: "title:gloria patri",
      kind: "slides" as const,
      deckId: "d1",
      updatedAt: "t",
    };
    expect(
      suggestDeck({ title: "Gloria Patri" } as never, [mapping], [
        { id: "d1", name: "Gloria Patri", deletedAt: "x" },
      ]),
    ).toBeNull();
  });
  it("carryOverSlidesRow keeps the operator's subset and overrides for the same deck only", () => {
    const old = {
      kind: "slides",
      id: "r",
      deckId: "d",
      slideIds: ["a"],
      fieldOverrides: { a: { t: "X" } },
      templateId: "T",
      sermonNotesId: "n",
    } as SlidesRowFields;
    expect(carryOverSlidesRow(old, { kind: "slides", id: "r", deckId: "d" })).toMatchObject({
      slideIds: ["a"],
      fieldOverrides: { a: { t: "X" } },
      templateId: "T",
    });
    expect(
      carryOverSlidesRow(old, { kind: "slides", id: "r", deckId: "other" }).slideIds,
    ).toBeUndefined();
  });
});
