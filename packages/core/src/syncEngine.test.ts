import { describe, expect, it, beforeEach } from "vitest";
import type {
  ChannelConfig,
  Hotcard,
  Project,
  ProjectChannelOverride,
  Show,
  Song,
  StorageAdapter,
  Template,
} from "./index";
import { sync } from "./syncEngine";

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
  const channels = new Map<string, ChannelConfig>();
  const overrides = new Map<string, ProjectChannelOverride>();

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

function makeChannel(overrides: Partial<ChannelConfig> = {}): ChannelConfig {
  return {
    id: "program",
    name: "Program",
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
