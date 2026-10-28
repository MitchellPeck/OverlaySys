import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { DeckSchema, ShowSchema, type Deck } from "@overlaysys/core";
import * as decks from "./decks";
import * as decksStore from "./decksStore";
import * as shows from "./shows";

let tmpDir: string;
let prevData: string | undefined;
let prevFix: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-decks-"));
  prevData = process.env["OVERLAYSYS_DATA_DIR"];
  prevFix = process.env["OVERLAYSYS_FIXTURES_DIR"];
  process.env["OVERLAYSYS_DATA_DIR"] = tmpDir;
  process.env["OVERLAYSYS_FIXTURES_DIR"] = tmpDir;
  await decks.reloadDecks();
  await shows.reloadShows();
});

afterEach(async () => {
  if (prevData === undefined) delete process.env["OVERLAYSYS_DATA_DIR"];
  else process.env["OVERLAYSYS_DATA_DIR"] = prevData;
  if (prevFix === undefined) delete process.env["OVERLAYSYS_FIXTURES_DIR"];
  else process.env["OVERLAYSYS_FIXTURES_DIR"] = prevFix;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function deckFixture(p: Partial<Deck> = {}): Deck {
  const base = {
    id: "d1",
    name: "Deck A",
    defaultTemplateId: "t1",
    licensing: { kind: "own" },
    slides: [
      { id: "s1", data: { text: "Line A" } },
      { id: "s2", data: { text: "Line B" } },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  // Spread after parse so a test can pass createdAt: undefined (a caller that omits it).
  return { ...DeckSchema.parse(base), ...p };
}

describe("deck registry", () => {
  it("saveDeck stamps updatedAt, defaults createdAt, round-trips through disk", async () => {
    const saved = await decks.saveDeck(deckFixture({ createdAt: undefined as never }));
    expect(saved.updatedAt).toBeTruthy();
    expect(saved.createdAt).toBeTruthy();
    await decks.reloadDecks();
    expect((await decks.getDeck(saved.id))!.name).toBe(saved.name);
  });

  it("saveDeck keeps the original createdAt for a known id", async () => {
    await decks.saveDeck(deckFixture());
    const again = await decks.saveDeck(deckFixture({ createdAt: "2030-01-01T00:00:00.000Z" }));
    expect(again.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("delete tombstones; list hides it; restore brings it back", async () => {
    await decks.saveDeck(deckFixture({ id: "d1" }));
    expect(await decks.deleteDeck("d1")).toBe(true);
    expect(await decks.getDeck("d1")).toBeNull();
    expect(await decks.listDecks()).toEqual([]);
    expect(decks.deckRegistrySnapshot().has("d1")).toBe(false);
    expect((await decksStore.loadDeck("d1"))!.deletedAt).toBeTruthy();
    expect((await decks.restoreDeck("d1"))!.deletedAt).toBeUndefined();
    expect(await decks.getDeck("d1")).not.toBeNull();
  });

  it("duplicateDeck names the copy '<name> copy' with fresh slide ids", async () => {
    await decks.saveDeck(deckFixture({ id: "d1", name: "Doxology" }));
    const copy = (await decks.duplicateDeck("d1"))!;
    expect(copy.name).toBe("Doxology copy");
    expect(copy.id).not.toBe("d1");
    expect(copy.slides.map((s) => s.id)).not.toContain("s1");
    expect(copy.slides.map((s) => s.data)).toEqual([{ text: "Line A" }, { text: "Line B" }]);
  });

  it("listDeckMetas counts live shows that use the deck", async () => {
    await decks.saveDeck(deckFixture({ id: "d1" }));
    const slidesRow = (id: string) => ({ kind: "slides", id, deckId: "d1" });
    const mk = (id: string) =>
      ShowSchema.parse({ id, name: id, projectId: "p", rows: [slidesRow("r1"), slidesRow("r2")], songs: [] });
    await shows.saveShow(mk("live-show"));
    await shows.saveShow(mk("dead-show"));
    await shows.deleteShow("dead-show");
    const meta = (await decks.listDeckMetas()).find((m) => m.id === "d1")!;
    expect(meta.usedBy).toBe(1);
    expect(meta.slideCount).toBe(2);
    expect(meta.licensing).toBe("own");
  });
});
