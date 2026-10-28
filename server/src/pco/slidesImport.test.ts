import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Deck, PcoPlanItem } from "@overlaysys/core";
import * as decks from "../decks";
import { listItemMappings, reloadItemMappings, upsertItemMapping } from "./itemMappings";
import { rememberSlidesChoices, slidesSuggestionsFor } from "./slidesImport";

let tmpDir: string;
let prev: string | undefined;

const deck = (id: string, name: string): Deck => ({
  id,
  name,
  tags: [],
  defaultTemplateId: "tpl-graphic",
  licensing: { kind: "own" },
  slides: [{ id: `${id}-a`, data: { headline: "Line A" } }],
  createdAt: "2026-10-01T00:00:00.000Z",
});

const ITEMS: PcoPlanItem[] = [
  { id: "i1", title: "Call to Worship", sequence: 1, itemType: "item" },
  { id: "i2", title: "Psalm 23", sequence: 2, itemType: "item" },
  { id: "i3", title: "Doxology", sequence: 3, itemType: "song", song: { id: "pco-song-X", title: "Doxology" } },
  { id: "i4", title: "Announcements", sequence: 4, itemType: "item" },
];

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-slidesimport-"));
  prev = process.env["OVERLAYSYS_DATA_DIR"];
  process.env["OVERLAYSYS_DATA_DIR"] = tmpDir;
  await decks.reloadDecks();
  await reloadItemMappings();
  await decks.saveDeck(deck("deck-cw", "Call to Worship"));
  await decks.saveDeck(deck("deck-p100", "Psalm 100"));
  await decks.saveDeck(deck("deck-dox", "Doxology (Liturgy)"));
});

afterEach(async () => {
  if (prev === undefined) delete process.env["OVERLAYSYS_DATA_DIR"];
  else process.env["OVERLAYSYS_DATA_DIR"] = prev;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("slidesSuggestionsFor", () => {
  it("suggests by name, keeps numbers apart, and omits items with no match", async () => {
    const out = await slidesSuggestionsFor(ITEMS);
    expect(out["i1"]).toEqual({ deckId: "deck-cw", deckName: "Call to Worship", via: "name" });
    expect(out["i2"]).toBeUndefined();
    expect(out["i3"]).toBeUndefined();
    expect(Object.keys(out)).toEqual(["i1"]);
  });

  it("a remembered PCO song mapping wins over a title match", async () => {
    await upsertItemMapping({ key: "title:doxology", kind: "slides", deckId: "deck-cw" });
    await upsertItemMapping({ key: "pcoSong:pco-song-X", kind: "slides", deckId: "deck-dox", templateId: "tpl-lyric" });
    const out = await slidesSuggestionsFor(ITEMS);
    expect(out["i3"]).toMatchObject({ deckId: "deck-dox", via: "remembered", templateId: "tpl-lyric" });
  });

  it("ignores a remembered mapping whose deck was deleted", async () => {
    await upsertItemMapping({ key: "title:call to worship", kind: "slides", deckId: "deck-p100" });
    await decks.deleteDeck("deck-p100");
    const out = await slidesSuggestionsFor(ITEMS);
    expect(out["i1"]).toEqual({ deckId: "deck-cw", deckName: "Call to Worship", via: "name" });
  });
});

describe("rememberSlidesChoices", () => {
  it("writes the title key, plus the pcoSong key for a linked song, and counts the writes", async () => {
    const n = await rememberSlidesChoices(ITEMS, [
      { itemId: "i1", kind: "slides", deckId: "deck-cw", remember: true },
      { itemId: "i3", kind: "slides", deckId: "deck-dox", remember: true, templateId: "tpl-lyric" },
      { itemId: "i2", kind: "slides", deckId: "deck-p100", remember: false },
      { itemId: "i4", kind: "slides", deckId: "deck-cw" },
      { itemId: "i4", kind: "graphic", remember: true } as never,
    ]);
    expect(n).toBe(3);
    const keys = (await listItemMappings()).map((m) => [m.key, m.deckId, m.templateId]);
    expect(keys.sort()).toEqual([
      ["pcoSong:pco-song-X", "deck-dox", "tpl-lyric"],
      ["title:call to worship", "deck-cw", undefined],
      ["title:doxology", "deck-dox", "tpl-lyric"],
    ]);
  });

  it("skips a config with no deck or an item not in the plan", async () => {
    const n = await rememberSlidesChoices(ITEMS, [
      { itemId: "i1", kind: "slides", remember: true },
      { itemId: "nope", kind: "slides", deckId: "deck-cw", remember: true },
    ]);
    expect(n).toBe(0);
    expect(await listItemMappings()).toEqual([]);
  });

  it("re-remembering a title moves it to the new deck", async () => {
    await rememberSlidesChoices(ITEMS, [{ itemId: "i1", kind: "slides", deckId: "deck-cw", remember: true }]);
    await rememberSlidesChoices(ITEMS, [{ itemId: "i1", kind: "slides", deckId: "deck-p100", remember: true }]);
    const all = await listItemMappings();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ key: "title:call to worship", deckId: "deck-p100" });
  });
});
