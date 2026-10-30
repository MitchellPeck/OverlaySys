import { describe, expect, it, beforeEach, vi } from "vitest";
import type {
  ChannelConfig,
  Deck,
  Hotcard,
  PcoItemMapping,
  Project,
  ProjectChannelOverride,
  Show,
  Song,
  StageLayout,
  StorageAdapter,
  Template,
} from "./index";
import { SPEAKER_LAYOUT, StageLayoutSchema } from "./stageLayout";
import { _resetSyncEngineForTest, sync } from "./syncEngine";

// In-memory adapter used by every test below. Holds Maps keyed by the
// entity's primary id (or `${projectId}:${channelId}` for overrides).
// All the read methods are a single line — listSince returns everything
// including tombstones since we don't model watermarks here, the
// non-since list methods filter tombstones out for symmetry with the
// production adapters' user-facing reads.
function makeMemAdapter(): StorageAdapter {
  const projects = new Map<string, Project>();
  const shows = new Map<string, Show>();
  const hotcards = new Map<string, Hotcard>();
  const songs = new Map<string, Song>();
  const templates = new Map<string, Template>();
  const stageLayouts = new Map<string, StageLayout>();
  const channels = new Map<string, ChannelConfig>();
  const overrides = new Map<string, ProjectChannelOverride>();
  const decks = new Map<string, Deck>();
  const mappings = new Map<string, PcoItemMapping>();

  const live = <T extends { deletedAt?: string }>(items: T[]): T[] =>
    items.filter((i) => !i.deletedAt);

  return {
    listProjects: async () => live([...projects.values()]),
    listProjectsSince: async () => [...projects.values()],
    getProject: async (_, id) => projects.get(id) ?? null,
    saveProject: async (_, p) => {
      projects.set(p.id, p);
    },
    deleteProject: async (_, id) => projects.delete(id),

    listShows: async () => live([...shows.values()]),
    listShowsSince: async () => [...shows.values()],
    getShow: async (_, id) => shows.get(id) ?? null,
    saveShow: async (_, s) => {
      shows.set(s.id, s);
    },
    deleteShow: async (_, id) => shows.delete(id),

    listHotcards: async () => live([...hotcards.values()]),
    listHotcardsSince: async () => [...hotcards.values()],
    getHotcard: async (_, id) => hotcards.get(id) ?? null,
    saveHotcard: async (_, h) => {
      hotcards.set(h.id, h);
    },
    deleteHotcard: async (_, id) => hotcards.delete(id),

    listSongs: async () => live([...songs.values()]),
    listSongsSince: async () => [...songs.values()],
    getSong: async (_, id) => songs.get(id) ?? null,
    saveSong: async (_, s) => {
      songs.set(s.id, s);
    },
    deleteSong: async (_, id) => songs.delete(id),

    listTemplates: async () => live([...templates.values()]),
    listTemplatesSince: async () => [...templates.values()],
    getTemplate: async (_, id) => templates.get(id) ?? null,
    saveTemplate: async (_, t) => {
      templates.set(t.id, t);
    },
    deleteTemplate: async (_, id) => templates.delete(id),

    listStageLayouts: async () => live([...stageLayouts.values()]),
    listStageLayoutsSince: async () => [...stageLayouts.values()],
    getStageLayout: async (_, id) => stageLayouts.get(id) ?? null,
    saveStageLayout: async (_, l) => {
      stageLayouts.set(l.id, l);
    },
    deleteStageLayout: async (_, id) => stageLayouts.delete(id),

    listChannelConfigs: async () => live([...channels.values()]),
    listChannelConfigsSince: async () => [...channels.values()],
    getChannelConfig: async (_, id) => channels.get(id) ?? null,
    saveChannelConfig: async (_, c) => {
      channels.set(c.id, c);
    },
    deleteChannelConfig: async (_, id) => channels.delete(id),

    listProjectChannelOverrides: async () => live([...overrides.values()]),
    listProjectChannelOverridesSince: async () => [...overrides.values()],
    saveProjectChannelOverride: async (_, o) => {
      overrides.set(`${o.projectId}:${o.channelId}`, o);
    },
    deleteProjectChannelOverride: async (_, pid, cid) =>
      overrides.delete(`${pid}:${cid}`),

    listDecks: async () => live([...decks.values()]),
    listDecksSince: async () => [...decks.values()],
    getDeck: async (_, id) => decks.get(id) ?? null,
    saveDeck: async (_, d) => {
      decks.set(d.id, d);
    },
    deleteDeck: async (_, id) => decks.delete(id),

    listPcoItemMappings: async () => live([...mappings.values()]),
    listPcoItemMappingsSince: async () => [...mappings.values()],
    savePcoItemMapping: async (_, m) => {
      mappings.set(m.id, m);
    },
    deletePcoItemMapping: async (_, id) => mappings.delete(id),

    putAsset: async () => undefined,
    hasAsset: async () => false,
    getAssetUrl: async () => null,
  };
}

const ORG = "org-1";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    name: "Project 1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeStageLayout(overrides: Partial<StageLayout> = {}): StageLayout {
  return StageLayoutSchema.parse({
    ...SPEAKER_LAYOUT,
    id: "stage-layout-aaaa1111",
    name: "Mine",
    ...overrides,
  });
}

function makeDeck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: "deck-1",
    name: "Deck 1",
    tags: [],
    defaultTemplateId: "tpl-1",
    licensing: { kind: "own" },
    slides: [{ id: "s1", data: { text: "Line A" } }],
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeMapping(overrides: Partial<PcoItemMapping> = {}): PcoItemMapping {
  return {
    id: "pcoSong:42",
    key: "pcoSong:42",
    kind: "slides",
    deckId: "deck-1",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeChannel(overrides: Partial<ChannelConfig> = {}): ChannelConfig {
  return {
    id: "program",
    name: "Program",
    kind: "graphics",
    renderMode: "normal",
    background: "transparent",
    ...overrides,
  };
}

describe("syncEngine.sync", () => {
  let local: StorageAdapter;
  let remote: StorageAdapter;
  beforeEach(() => {
    local = makeMemAdapter();
    remote = makeMemAdapter();
  });

  it("pulls a remote-only record into the local replica", async () => {
    await remote.saveChannelConfig(
      ORG,
      makeChannel({ updatedAt: "2026-05-01T00:00:00Z" }),
    );
    const result = await sync(local, remote, ORG);
    expect(result.pulled).toBe(1);
    expect(result.pushed).toBe(0);
    expect(await local.getChannelConfig(ORG, "program")).toMatchObject({
      id: "program",
      name: "Program",
    });
  });

  it("pushes a local-only record to the remote replica", async () => {
    await local.saveChannelConfig(
      ORG,
      makeChannel({ updatedAt: "2026-05-01T00:00:00Z" }),
    );
    const result = await sync(local, remote, ORG);
    expect(result.pushed).toBe(1);
    expect(result.pulled).toBe(0);
    expect(await remote.getChannelConfig(ORG, "program")).toMatchObject({
      id: "program",
      name: "Program",
    });
  });

  it("LWW: newer updatedAt wins regardless of side", async () => {
    await local.saveChannelConfig(
      ORG,
      makeChannel({ name: "Local Program", updatedAt: "2026-05-01T00:00:00Z" }),
    );
    await remote.saveChannelConfig(
      ORG,
      makeChannel({ name: "Remote Program", updatedAt: "2026-05-02T00:00:00Z" }),
    );
    const result = await sync(local, remote, ORG);
    expect(result.pulled).toBe(1);
    expect(result.pushed).toBe(0);
    expect((await local.getChannelConfig(ORG, "program"))?.name).toBe(
      "Remote Program",
    );
  });

  it("is a no-op when both sides agree (equal updatedAt)", async () => {
    const same = makeChannel({ updatedAt: "2026-05-01T00:00:00Z" });
    await local.saveChannelConfig(ORG, same);
    await remote.saveChannelConfig(ORG, same);
    const result = await sync(local, remote, ORG);
    expect(result.pulled).toBe(0);
    expect(result.pushed).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it("propagates a remote tombstone to local (deletion sync)", async () => {
    // Both sides start with the live record.
    await local.saveChannelConfig(
      ORG,
      makeChannel({ updatedAt: "2026-05-01T00:00:00Z" }),
    );
    // Remote tombstones with a later updatedAt.
    await remote.saveChannelConfig(
      ORG,
      makeChannel({
        updatedAt: "2026-05-02T00:00:00Z",
        deletedAt: "2026-05-02T00:00:00Z",
      }),
    );
    const result = await sync(local, remote, ORG);
    expect(result.pulled).toBe(1);
    // Local now holds the tombstone — the user-facing list filters it out.
    expect(await local.listChannelConfigs(ORG)).toEqual([]);
    // listSince includes the tombstone so a subsequent sync still sees it.
    expect((await local.listChannelConfigsSince(ORG, "")).length).toBe(1);
  });

  it("propagates a local tombstone to remote", async () => {
    await remote.saveChannelConfig(
      ORG,
      makeChannel({ updatedAt: "2026-05-01T00:00:00Z" }),
    );
    await local.saveChannelConfig(
      ORG,
      makeChannel({
        updatedAt: "2026-05-02T00:00:00Z",
        deletedAt: "2026-05-02T00:00:00Z",
      }),
    );
    const result = await sync(local, remote, ORG);
    expect(result.pushed).toBe(1);
    expect(await remote.listChannelConfigs(ORG)).toEqual([]);
  });

  it("handles multiple tables in one pass", async () => {
    await remote.saveProject(ORG, makeProject({ updatedAt: "2026-05-01T00:00:00Z" }));
    await local.saveChannelConfig(
      ORG,
      makeChannel({ updatedAt: "2026-05-01T00:00:00Z" }),
    );
    const result = await sync(local, remote, ORG);
    expect(result.perTable.projects.pulled).toBe(1);
    expect(result.perTable.channelConfigs.pushed).toBe(1);
  });

  it("reconciles project channel overrides by (projectId, channelId)", async () => {
    // Same channelId, different projects — must not collide.
    await remote.saveProjectChannelOverride(ORG, {
      projectId: "sunday",
      channelId: "program",
      background: "#00ff00",
      updatedAt: "2026-05-01T00:00:00Z",
    });
    await local.saveProjectChannelOverride(ORG, {
      projectId: "christmas",
      channelId: "program",
      background: "#ff0000",
      updatedAt: "2026-05-01T00:00:00Z",
    });
    const result = await sync(local, remote, ORG);
    expect(result.pulled).toBe(1);
    expect(result.pushed).toBe(1);
    const localOv = await local.listProjectChannelOverrides(ORG);
    expect(localOv).toHaveLength(2);
    const remoteOv = await remote.listProjectChannelOverrides(ORG);
    expect(remoteOv).toHaveLength(2);
  });

  it("pulls a remote-only stage layout and pushes a newer local one", async () => {
    await remote.saveStageLayout(ORG, makeStageLayout({ updatedAt: "2026-05-01T00:00:00Z" }));
    let r = await sync(local, remote, ORG);
    expect(r.perTable.stageLayouts.pulled).toBe(1);
    expect(r.perTable.stageLayouts.pushed).toBe(0);
    expect(await local.getStageLayout(ORG, "stage-layout-aaaa1111")).not.toBeNull();

    await local.saveStageLayout(
      ORG,
      makeStageLayout({ name: "Edited", updatedAt: "2026-05-02T00:00:00Z" }),
    );
    r = await sync(local, remote, ORG);
    expect(r.perTable.stageLayouts.pushed).toBe(1);
    expect((await remote.getStageLayout(ORG, "stage-layout-aaaa1111"))?.name).toBe("Edited");
  });

  it("propagates a local stage-layout tombstone to remote", async () => {
    await remote.saveStageLayout(ORG, makeStageLayout({ updatedAt: "2026-05-01T00:00:00Z" }));
    await local.saveStageLayout(
      ORG,
      makeStageLayout({ updatedAt: "2026-05-02T00:00:00Z", deletedAt: "2026-05-02T00:00:00Z" }),
    );
    const r = await sync(local, remote, ORG);
    expect(r.perTable.stageLayouts.pushed).toBe(1);
    expect(await remote.listStageLayouts(ORG)).toEqual([]);
    const [row] = await remote.listStageLayoutsSince(ORG, "");
    expect(row?.deletedAt).toBe("2026-05-02T00:00:00Z");
  });

  it.each([
    ["Postgres 42P01", { code: "42P01", message: 'relation "overlaysys.stage_layouts" does not exist' }],
    ["PostgREST PGRST205", { code: "PGRST205", message: "Could not find the table 'overlaysys.stage_layouts' in the schema cache" }],
    ["plain Error", new Error('relation "overlaysys.stage_layouts" does not exist')],
  ])("a missing remote stage_layouts table (%s) is skipped, not an error", async (_, thrown) => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    _resetSyncEngineForTest();
    remote.listStageLayoutsSince = async () => {
      throw thrown;
    };
    await local.saveProject(ORG, makeProject({ updatedAt: "2026-05-01T00:00:00Z" }));
    const r = await sync(local, remote, ORG);
    expect(r.errors).toEqual([]);
    expect(r.perTable.projects.pushed).toBe(1); // other tables still ran
    await sync(local, remote, ORG);
    expect(info).toHaveBeenCalledTimes(1); // logged once, not every pass
    info.mockRestore();
  });

  it("decks: remote-only pulls, newer local pushes, tombstones propagate", async () => {
    await remote.saveDeck(ORG, makeDeck({ updatedAt: "2026-05-01T00:00:00Z" }));
    let r = await sync(local, remote, ORG);
    expect(r.perTable.decks).toEqual({ pulled: 1, pushed: 0 });
    expect((await local.getDeck(ORG, "deck-1"))?.name).toBe("Deck 1");

    await local.saveDeck(ORG, makeDeck({ name: "Edited", updatedAt: "2026-05-02T00:00:00Z" }));
    r = await sync(local, remote, ORG);
    expect(r.perTable.decks).toEqual({ pulled: 0, pushed: 1 });
    expect((await remote.getDeck(ORG, "deck-1"))?.name).toBe("Edited");

    await remote.saveDeck(
      ORG,
      makeDeck({ updatedAt: "2026-05-03T00:00:00Z", deletedAt: "2026-05-03T00:00:00Z" }),
    );
    r = await sync(local, remote, ORG);
    expect(r.perTable.decks).toEqual({ pulled: 1, pushed: 0 });
    expect(await local.listDecks(ORG)).toEqual([]);
    const [row] = await local.listDecksSince(ORG, "");
    expect(row?.deletedAt).toBe("2026-05-03T00:00:00Z");
  });

  it("pcoItemMappings: LWW by updatedAt on the mapping id", async () => {
    await local.savePcoItemMapping(ORG, makeMapping({ deckId: "deck-local", updatedAt: "2026-05-02T00:00:00Z" }));
    await remote.savePcoItemMapping(ORG, makeMapping({ deckId: "deck-remote", updatedAt: "2026-05-01T00:00:00Z" }));
    await remote.savePcoItemMapping(
      ORG,
      makeMapping({ id: "title:psalm 23", key: "title:psalm 23", deckId: "deck-23", updatedAt: "2026-05-01T00:00:00Z" }),
    );
    let r = await sync(local, remote, ORG);
    expect(r.perTable.pcoItemMappings).toEqual({ pulled: 1, pushed: 1 });
    expect((await remote.listPcoItemMappings(ORG)).find((m) => m.id === "pcoSong:42")?.deckId).toBe("deck-local");
    expect((await local.listPcoItemMappings(ORG)).find((m) => m.id === "title:psalm 23")?.deckId).toBe("deck-23");

    await remote.savePcoItemMapping(ORG, makeMapping({ deckId: "deck-newer", updatedAt: "2026-05-03T00:00:00Z" }));
    r = await sync(local, remote, ORG);
    expect(r.perTable.pcoItemMappings).toEqual({ pulled: 1, pushed: 0 });
    expect((await local.listPcoItemMappings(ORG)).find((m) => m.id === "pcoSong:42")?.deckId).toBe("deck-newer");
  });

  it("a missing remote decks table is skipped quietly", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    _resetSyncEngineForTest();
    remote.listDecksSince = async () => {
      throw { code: "42P01", message: 'relation "overlaysys.decks" does not exist' };
    };
    await local.saveDeck(ORG, makeDeck({ updatedAt: "2026-05-01T00:00:00Z" }));
    const r = await sync(local, remote, ORG);
    expect(r.errors).toEqual([]);
    expect(r.perTable.decks).toEqual({ pulled: 0, pushed: 0 });
    expect(await local.getDeck(ORG, "deck-1")).not.toBeNull(); // local deck untouched
    expect(info).toHaveBeenCalledWith("[sync] remote decks table unavailable; skipping until it is migrated");
    info.mockRestore();
  });

  it("a missing remote pco_item_mappings table (PGRST205) is skipped quietly", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    _resetSyncEngineForTest();
    remote.listPcoItemMappingsSince = async () => {
      throw { code: "PGRST205", message: "Could not find the table 'overlaysys.pco_item_mappings' in the schema cache" };
    };
    await local.savePcoItemMapping(ORG, makeMapping());
    const r = await sync(local, remote, ORG);
    expect(r.errors).toEqual([]);
    expect(r.perTable.pcoItemMappings).toEqual({ pulled: 0, pushed: 0 });
    expect(await local.listPcoItemMappings(ORG)).toHaveLength(1);
    await sync(local, remote, ORG);
    expect(info).toHaveBeenCalledTimes(1);
    info.mockRestore();
  });

  it("other stage_layouts list failures still count as errors", async () => {
    remote.listStageLayoutsSince = async () => {
      throw new Error("fetch failed");
    };
    const r = await sync(local, remote, ORG);
    expect(r.errors).toEqual([expect.objectContaining({ kind: "stageLayouts", id: "(list)", message: "fetch failed" })]);
  });

  it("a missing table other than stage_layouts is still an error", async () => {
    remote.listTemplatesSince = async () => {
      throw { code: "42P01", message: 'relation "overlaysys.templates" does not exist' };
    };
    const r = await sync(local, remote, ORG);
    expect(r.errors).toEqual([expect.objectContaining({ kind: "templates", id: "(list)" })]);
  });

  it("reports a plain PostgREST error object's message and code, not [object Object]", async () => {
    remote.listTemplatesSince = async () => {
      throw { code: "42501", message: "permission denied for table templates", details: null, hint: null };
    };
    const r = await sync(local, remote, ORG);
    expect(r.errors).toEqual([
      expect.objectContaining({ kind: "templates", message: "permission denied for table templates (42501)" }),
    ]);
  });

  it("aggregates per-record errors without aborting the pass", async () => {
    // Wire one adapter to fail saveChannelConfig but succeed everything else.
    const failingRemote: StorageAdapter = {
      ...remote,
      saveChannelConfig: async () => {
        throw new Error("simulated remote failure");
      },
    };
    await local.saveChannelConfig(
      ORG,
      makeChannel({ updatedAt: "2026-05-01T00:00:00Z" }),
    );
    await local.saveProject(ORG, makeProject({ updatedAt: "2026-05-01T00:00:00Z" }));
    const result = await sync(local, failingRemote, ORG);
    // Project still pushes despite the channel error.
    expect(result.perTable.projects.pushed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.kind).toBe("channelConfigs");
    expect(result.errors[0]?.message).toContain("simulated remote failure");
  });

  it("treats missing updatedAt as oldest (legacy pre-sync records get overwritten)", async () => {
    // Legacy local file with no updatedAt — anything newer on the remote
    // side should win.
    await local.saveChannelConfig(ORG, makeChannel({ name: "Legacy" }));
    await remote.saveChannelConfig(
      ORG,
      makeChannel({ name: "Fresh", updatedAt: "2026-05-01T00:00:00Z" }),
    );
    const result = await sync(local, remote, ORG);
    expect(result.pulled).toBe(1);
    expect((await local.getChannelConfig(ORG, "program"))?.name).toBe("Fresh");
  });
});

describe("syncEngine.sync — timestamp formats", () => {
  it("compares timestamps as instants, so `Z` vs `+00:00` spellings of one moment are equal", async () => {
    // Local disk writes `…00.000Z` (JS toISOString); PostgREST returns the
    // same instant as `…00+00:00`. A string compare would call local newer
    // and push it back every pass.
    const local = makeMemAdapter();
    const remote = makeMemAdapter();
    await local.saveChannelConfig(ORG, makeChannel({ updatedAt: "2026-08-29T12:00:00.000Z" }));
    await remote.saveChannelConfig(ORG, makeChannel({ name: "Cloud", updatedAt: "2026-08-29T12:00:00+00:00" }));
    const result = await sync(local, remote, ORG);
    expect(result.pushed).toBe(0);
    expect(result.pulled).toBe(0);
    expect(result.overwrites).toEqual([]);
  });

  it("still orders correctly across formats when the instants differ", async () => {
    const local = makeMemAdapter();
    const remote = makeMemAdapter();
    await local.saveChannelConfig(ORG, makeChannel({ updatedAt: "2026-08-29T12:00:00.000Z" }));
    await remote.saveChannelConfig(ORG, makeChannel({ name: "Cloud", updatedAt: "2026-08-29T12:00:01+00:00" }));
    const result = await sync(local, remote, ORG);
    expect(result.pulled).toBe(1);
    expect((await local.getChannelConfig(ORG, "program"))?.name).toBe("Cloud");
    expect(result.overwrites).toHaveLength(1);
  });

  it("treats a missing updatedAt as oldest even against an offset-formatted remote", async () => {
    const local = makeMemAdapter();
    const remote = makeMemAdapter();
    await local.saveChannelConfig(ORG, makeChannel({ name: "Fixture" }));
    await remote.saveChannelConfig(ORG, makeChannel({ name: "Cloud", updatedAt: "2026-08-29T12:00:00+00:00" }));
    const result = await sync(local, remote, ORG);
    expect(result.pulled).toBe(1);
    expect((await local.getChannelConfig(ORG, "program"))?.name).toBe("Cloud");
    // No prior local write → a first-time fetch, not a user-visible overwrite.
    expect(result.overwrites).toEqual([]);
  });
});

describe("syncEngine.sync — [I4] lossy show pulls from older clients", () => {
  const show = (rows: unknown[], updatedAt: string, extra: Partial<Show> = {}): Show =>
    ({ id: "sh", name: "Sunday", projectId: "p", rows, songs: [], updatedAt, ...extra }) as Show;
  const gfx = (id: string, sectionId?: string) => ({ kind: "graphic", id, templateId: "t", data: {}, ...(sectionId ? { sectionId } : {}) });
  let local: StorageAdapter;
  let remote: StorageAdapter;
  beforeEach(() => {
    local = makeMemAdapter();
    remote = makeMemAdapter();
  });

  it("keeps local and warns when a newer cloud copy has rows: [] over a non-empty local show", async () => {
    await local.saveShow(ORG, show([gfx("r1"), gfx("r2")], "2026-05-01T00:00:00Z"));
    await remote.saveShow(ORG, show([], "2026-05-02T00:00:00Z"));
    const result = await sync(local, remote, ORG);
    expect((await local.getShow(ORG, "sh"))!.rows).toHaveLength(2);
    expect(result.pulled).toBe(0);
    expect(result.pushed).toBe(0);
    expect(result.overwrites).toEqual([]);
    expect(result.warnings).toEqual([{ kind: "shows", id: "sh", message: expect.stringContaining("no rows") }]);
  });

  it("keeps local when the cloud copy stripped every row's section membership", async () => {
    await local.saveShow(ORG, show([gfx("r1", "s1"), gfx("r2")], "2026-05-01T00:00:00Z"));
    await remote.saveShow(ORG, show([gfx("r1"), gfx("r2")], "2026-05-02T00:00:00Z"));
    const result = await sync(local, remote, ORG);
    expect((await local.getShow(ORG, "sh"))!.rows[0]!.sectionId).toBe("s1");
    expect(result.warnings[0]!.message).toMatch(/section membership/);
  });

  it("applies a sections-aware edit that deleted the last section but kept its rows", async () => {
    await local.saveShow(ORG, show([gfx("r1", "s1"), gfx("r2", "s1")], "2026-05-01T00:00:00Z", { sections: [{ id: "s1", name: "Worship" }] }));
    await remote.saveShow(ORG, show([gfx("r1"), gfx("r2")], "2026-05-02T00:00:00Z", { sections: [] }));
    const result = await sync(local, remote, ORG);
    expect(result.warnings).toEqual([]);
    expect(result.pulled).toBe(1);
    expect((await local.getShow(ORG, "sh"))!.rows.every((r) => !r.sectionId)).toBe(true);
  });

  it("keeps local when the cloud copy still lists the section its rows lost", async () => {
    await local.saveShow(ORG, show([gfx("r1", "s1")], "2026-05-01T00:00:00Z", { sections: [{ id: "s1", name: "Worship" }] }));
    await remote.saveShow(ORG, show([gfx("r1")], "2026-05-02T00:00:00Z", { sections: [{ id: "s1", name: "Worship" }] }));
    const result = await sync(local, remote, ORG);
    expect(result.warnings[0]!.message).toMatch(/section membership/);
    expect((await local.getShow(ORG, "sh"))!.rows[0]!.sectionId).toBe("s1");
  });

  it("still applies ordinary newer edits, tombstones, and a remote that keeps some sections", async () => {
    await local.saveShow(ORG, show([gfx("r1", "s1"), gfx("r2", "s1")], "2026-05-01T00:00:00Z"));
    await remote.saveShow(ORG, show([gfx("r1", "s1"), gfx("r2")], "2026-05-02T00:00:00Z"));
    let result = await sync(local, remote, ORG);
    expect(result.warnings).toEqual([]);
    expect((await local.getShow(ORG, "sh"))!.rows[1]!.sectionId).toBeUndefined();

    await remote.saveShow(ORG, show([], "2026-05-03T00:00:00Z", { deletedAt: "2026-05-03T00:00:00Z" }));
    result = await sync(local, remote, ORG);
    expect(result.warnings).toEqual([]);
    expect(result.pulled).toBe(1);
  });
});
