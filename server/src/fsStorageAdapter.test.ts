import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  SPEAKER_LAYOUT,
  ShowSchema,
  StageLayoutSchema,
  type Deck,
  type Hotcard,
  type PcoItemMapping,
  type Show,
} from "@overlaysys/core";
import * as storage from "./storage";
import { FsStorageAdapter } from "./fsStorageAdapter";
import { reloadItemMappings } from "./pco/itemMappings";

// The cloud `shows` table has no sermon-notes column yet, so a pulled show
// arrives without `sermonNotes`. The local replica must not lose them.

let tmpDir: string;
let prevDataDir: string | undefined;
let prevFixturesDir: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-fsadapter-"));
  prevDataDir = process.env["OVERLAYSYS_DATA_DIR"];
  prevFixturesDir = process.env["OVERLAYSYS_FIXTURES_DIR"];
  process.env["OVERLAYSYS_DATA_DIR"] = tmpDir;
  process.env["OVERLAYSYS_FIXTURES_DIR"] = tmpDir;
});

afterEach(async () => {
  if (prevDataDir === undefined) delete process.env["OVERLAYSYS_DATA_DIR"];
  else process.env["OVERLAYSYS_DATA_DIR"] = prevDataDir;
  if (prevFixturesDir === undefined) delete process.env["OVERLAYSYS_FIXTURES_DIR"];
  else process.env["OVERLAYSYS_FIXTURES_DIR"] = prevFixturesDir;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeShow(extra: Partial<Show> = {}): Show {
  return ShowSchema.parse({ id: "show-1", name: "Sunday", projectId: "p", rows: [], songs: [], ...extra });
}

const notes = [{ id: "n1", title: "Grace", body: "# One" }];

describe("FsStorageAdapter.saveShow keeps local sermon notes", () => {
  it("a pulled show without sermonNotes keeps the local ones", async () => {
    await storage.saveShow(makeShow({ sermonNotes: notes }));
    const pulled = makeShow({ name: "Renamed in cloud" });
    delete (pulled as { sermonNotes?: unknown }).sermonNotes;
    await new FsStorageAdapter().saveShow("org", pulled);
    const saved = await storage.loadShow("show-1");
    expect(saved?.name).toBe("Renamed in cloud");
    expect(saved?.sermonNotes).toEqual(notes);
  });

  it("an explicit [] still clears them", async () => {
    await storage.saveShow(makeShow({ sermonNotes: notes }));
    await new FsStorageAdapter().saveShow("org", makeShow({ sermonNotes: [] }));
    expect((await storage.loadShow("show-1"))?.sermonNotes).toEqual([]);
  });

  it("a brand-new show saves as-is", async () => {
    await new FsStorageAdapter().saveShow("org", makeShow());
    expect((await storage.loadShow("show-1"))?.sermonNotes).toBeUndefined();
  });
});

// Until `shows.extra` is live on every org, a pulled show can arrive without
// `sections`. The local replica keeps its own; an explicit [] still clears.
describe("FsStorageAdapter.saveShow keeps local sections", () => {
  const sections = [{ id: "sec-1", name: "Opening" }];

  it("a pulled show without sections keeps the local sections", async () => {
    await storage.saveShow(makeShow({ sections, sermonNotes: notes }));
    const slidesRow = { kind: "slides", id: "r1", sectionId: "sec-1", deckId: "deck-1", slideIds: ["a", "b"] };
    const pulled = ShowSchema.parse({
      id: "show-1", name: "Renamed in cloud", projectId: "p", songs: [], rows: [slidesRow],
    });
    expect("sections" in pulled).toBe(false);
    await new FsStorageAdapter().saveShow("org", pulled);
    const saved = await storage.loadShow("show-1");
    expect(saved?.name).toBe("Renamed in cloud");
    expect(saved?.sections).toEqual(sections);
    expect(saved?.rows).toEqual([slidesRow]);
    expect(saved?.sermonNotes).toEqual(notes);
  });

  it("an explicit sections: [] from the cloud clears them", async () => {
    await storage.saveShow(makeShow({ sections }));
    await new FsStorageAdapter().saveShow("org", makeShow({ sections: [] }));
    expect((await storage.loadShow("show-1"))?.sections).toEqual([]);
  });
});

// The cloud `hotcards` table has no hotkey column yet (plan 3), so a pulled
// hotcard arrives without `hotkey`. The local F-key must survive the pull.
describe("FsStorageAdapter.saveHotcard keeps the local hotkey", () => {
  const card = (extra: Partial<Hotcard> = {}): Hotcard => ({
    id: "hotcard-1",
    name: "Pastor",
    projectId: "p1",
    templateId: "l3",
    data: {},
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...extra,
  });

  it("a pulled hotcard without hotkey keeps the local key", async () => {
    await storage.saveHotcard(card({ hotkey: "F4" }));
    await new FsStorageAdapter().saveHotcard("org", card({ name: "Pastor (edited in cloud)" }));
    const saved = await storage.loadHotcard("hotcard-1");
    expect(saved?.hotkey).toBe("F4");
    expect(saved?.name).toBe("Pastor (edited in cloud)");
  });

  it("keeps a deliberate local null too, so the migration never renumbers it", async () => {
    await storage.saveHotcard(card({ hotkey: null }));
    await new FsStorageAdapter().saveHotcard("org", card());
    expect((await storage.loadHotcard("hotcard-1"))?.hotkey).toBeNull();
  });

  it("an incoming hotkey (once the cloud carries one) wins", async () => {
    await storage.saveHotcard(card({ hotkey: "F4" }));
    await new FsStorageAdapter().saveHotcard("org", card({ hotkey: "F6" }));
    expect((await storage.loadHotcard("hotcard-1"))?.hotkey).toBe("F6");
  });

  it("a brand-new pulled hotcard saves as-is", async () => {
    await new FsStorageAdapter().saveHotcard("org", card());
    expect((await storage.loadHotcard("hotcard-1"))?.hotkey).toBeUndefined();
  });
});

describe("FsStorageAdapter stage layouts", () => {
  it("save -> listStageLayoutsSince round-trips and includes tombstones; list hides them", async () => {
    const adapter = new FsStorageAdapter();
    const base = StageLayoutSchema.parse({
      ...SPEAKER_LAYOUT,
      id: "stage-layout-aaaa1111",
      name: "Mine",
    });
    await adapter.saveStageLayout("org", base);
    await adapter.saveStageLayout("org", { ...base, id: "stage-layout-bbbb2222", name: "Gone" });

    expect((await adapter.listStageLayouts("org")).map((l) => l.id).sort()).toEqual([
      "stage-layout-aaaa1111",
      "stage-layout-bbbb2222",
    ]);
    expect(await adapter.deleteStageLayout("org", "stage-layout-bbbb2222")).toBe(true);

    expect((await adapter.listStageLayouts("org")).map((l) => l.id)).toEqual(["stage-layout-aaaa1111"]);
    const since = await adapter.listStageLayoutsSince("org", "");
    expect(since.map((l) => l.id).sort()).toEqual(["stage-layout-aaaa1111", "stage-layout-bbbb2222"]);
    expect(since.find((l) => l.id === "stage-layout-bbbb2222")?.deletedAt).toBeTruthy();
    expect(await adapter.getStageLayout("org", "stage-layout-bbbb2222")).toBeNull();
    expect((await adapter.getStageLayout("org", "stage-layout-aaaa1111"))?.name).toBe("Mine");
    expect(await adapter.deleteStageLayout("org", "nope")).toBe(false);
  });

  it("strips builtIn from a stored layout", async () => {
    const adapter = new FsStorageAdapter();
    const l = StageLayoutSchema.parse({ ...SPEAKER_LAYOUT, id: "custom", builtIn: true });
    await adapter.saveStageLayout("org", l);
    const stored = (await adapter.listStageLayoutsSince("org", "")).find((x) => x.id === "custom");
    expect(stored).toBeDefined();
    expect(stored?.builtIn).toBeUndefined();
  });

  it("saving a built-in id writes nothing", async () => {
    const adapter = new FsStorageAdapter();
    await adapter.saveStageLayout("org", StageLayoutSchema.parse({ ...SPEAKER_LAYOUT, id: "speaker" }));
    expect(await adapter.listStageLayoutsSince("org", "")).toEqual([]);
  });
});

describe("FsStorageAdapter decks", () => {
  const deck = (extra: Partial<Deck> = {}): Deck => ({
    id: "deck-a",
    name: "Deck A",
    tags: [],
    defaultTemplateId: "tpl-1",
    licensing: { kind: "own" },
    slides: [{ id: "s1", data: { text: "Line A" } }],
    createdAt: "2026-10-01T00:00:00.000Z",
    ...extra,
  });

  it("save -> listDecksSince includes tombstones; listDecks and getDeck hide them", async () => {
    const adapter = new FsStorageAdapter();
    await adapter.saveDeck("org", deck({ updatedAt: "2026-10-02T00:00:00.000Z" }));
    await adapter.saveDeck("org", deck({ id: "deck-b", name: "Gone", updatedAt: "2026-10-02T00:00:00.000Z" }));
    expect((await adapter.listDecks("org")).map((d) => d.id).sort()).toEqual(["deck-a", "deck-b"]);

    expect(await adapter.deleteDeck("org", "deck-b")).toBe(true);
    expect((await adapter.listDecks("org")).map((d) => d.id)).toEqual(["deck-a"]);
    const since = await adapter.listDecksSince("org", "");
    expect(since.map((d) => d.id).sort()).toEqual(["deck-a", "deck-b"]);
    expect(since.find((d) => d.id === "deck-b")?.deletedAt).toBeTruthy();
    expect(await adapter.getDeck("org", "deck-b")).toBeNull();
    expect((await adapter.getDeck("org", "deck-a"))?.name).toBe("Deck A");
    expect(await adapter.deleteDeck("org", "nope")).toBe(false);
  });

  it("a pulled deck keeps its incoming updatedAt (not re-stamped)", async () => {
    const adapter = new FsStorageAdapter();
    await adapter.saveDeck("org", deck({ updatedAt: "2026-10-02T00:00:00.000Z" }));
    expect((await adapter.getDeck("org", "deck-a"))?.updatedAt).toBe("2026-10-02T00:00:00.000Z");
    const tomb = deck({ updatedAt: "2026-10-03T00:00:00.000Z", deletedAt: "2026-10-03T00:00:00.000Z" });
    await adapter.saveDeck("org", tomb);
    const [row] = await adapter.listDecksSince("org", "");
    expect(row).toMatchObject({ updatedAt: "2026-10-03T00:00:00.000Z", deletedAt: "2026-10-03T00:00:00.000Z" });
  });
});

describe("FsStorageAdapter PCO item mappings", () => {
  beforeEach(async () => {
    // The store caches per process; point it at this test's data dir.
    await reloadItemMappings();
  });

  const mapping = (extra: Partial<PcoItemMapping> = {}): PcoItemMapping => ({
    id: "pcoSong:42",
    key: "pcoSong:42",
    kind: "slides",
    deckId: "deck-a",
    updatedAt: "2026-10-02T00:00:00.000Z",
    ...extra,
  });

  it("save -> listPcoItemMappingsSince includes tombstones; list hides them", async () => {
    const adapter = new FsStorageAdapter();
    await adapter.savePcoItemMapping("org", mapping());
    await adapter.savePcoItemMapping("org", mapping({ id: "title:psalm 23", key: "title:psalm 23", deckId: "deck-23" }));
    expect((await adapter.listPcoItemMappings("org")).map((m) => m.id).sort()).toEqual(["pcoSong:42", "title:psalm 23"]);

    expect(await adapter.deletePcoItemMapping("org", "title:psalm 23")).toBe(true);
    expect((await adapter.listPcoItemMappings("org")).map((m) => m.id)).toEqual(["pcoSong:42"]);
    const since = await adapter.listPcoItemMappingsSince("org", "");
    expect(since.map((m) => m.id).sort()).toEqual(["pcoSong:42", "title:psalm 23"]);
    expect(since.find((m) => m.id === "title:psalm 23")?.deletedAt).toBeTruthy();
    expect(await adapter.deletePcoItemMapping("org", "nope")).toBe(false);
  });

  it("a pulled mapping keeps its incoming updatedAt and survives a reload from disk", async () => {
    const adapter = new FsStorageAdapter();
    const tomb = mapping({ updatedAt: "2026-10-05T00:00:00.000Z", deletedAt: "2026-10-05T00:00:00.000Z" });
    await adapter.savePcoItemMapping("org", tomb);
    await reloadItemMappings();
    expect(await adapter.listPcoItemMappingsSince("org", "")).toEqual([tomb]);
  });
});
