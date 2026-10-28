import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ChannelConfig, Project, Template } from "@overlaysys/core";
import * as storage from "./storage";
import * as templates from "./templates";
import * as channelConfigs from "./channelConfigs";
import * as projects from "./projects";
import * as shows from "./shows";
import * as songs from "./songs";

/**
 * The WS write path (operator edits) goes through these registries, while
 * the sync engine goes through FsStorageAdapter straight to storage. Both
 * share one on-disk replica, so the registries have to speak the sync
 * engine's dialect: stamp `updatedAt` on every local write (else LWW sees
 * an ancient or missing timestamp and the cloud silently wins / the edit
 * never pushes), soft-delete with a tombstone (else the record resurrects
 * from cloud on the next pass), and hide tombstones from readers.
 */

let tmpDir: string;
let prevDataDir: string | undefined;
let prevFixturesDir: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-registries-"));
  prevDataDir = process.env["OVERLAYSYS_DATA_DIR"];
  prevFixturesDir = process.env["OVERLAYSYS_FIXTURES_DIR"];
  process.env["OVERLAYSYS_DATA_DIR"] = tmpDir;
  // Point fixtures at the empty temp tree so the real repo fixtures don't
  // seed program/preview/alpha-program into every test.
  process.env["OVERLAYSYS_FIXTURES_DIR"] = tmpDir;
  await templates.reloadTemplates();
  await channelConfigs.reloadChannelConfigs();
  await projects.reloadProjects();
});

afterEach(async () => {
  if (prevDataDir === undefined) delete process.env["OVERLAYSYS_DATA_DIR"];
  else process.env["OVERLAYSYS_DATA_DIR"] = prevDataDir;
  if (prevFixturesDir === undefined) delete process.env["OVERLAYSYS_FIXTURES_DIR"];
  else process.env["OVERLAYSYS_FIXTURES_DIR"] = prevFixturesDir;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeTemplate(id: string): Template {
  return {
    id,
    name: id,
    size: { w: 1920, h: 1080 },
    fonts: [],
    fields: [],
    layers: [],
    timelines: {
      in: { duration: 0, tracks: [] },
      out: { duration: 0, tracks: [] },
    },
  };
}

function makeChannel(id: string): ChannelConfig {
  return { id, name: id, kind: "graphics", renderMode: "matte", mirrorOf: "program", background: "transparent" };
}

function makeProject(id: string): Project {
  return { id, name: id, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
}

describe("registry writes stamp updatedAt", () => {
  it("templates: a save without updatedAt gets one; a re-save bumps it", async () => {
    await templates.saveTemplate(makeTemplate("t1"));
    const first = await storage.loadTemplate("t1");
    expect(first?.updatedAt).toBeTruthy();
    await new Promise((r) => setTimeout(r, 5));
    await templates.saveTemplate({ ...makeTemplate("t1"), name: "renamed" });
    const second = await storage.loadTemplate("t1");
    expect(second?.updatedAt! > first!.updatedAt!).toBe(true);
  });

  it("channel configs: a save stamps updatedAt (fixtures never carry one)", async () => {
    await channelConfigs.saveChannelConfig(makeChannel("alpha-program"));
    const onDisk = await storage.loadChannelConfig("alpha-program");
    expect(onDisk?.updatedAt).toBeTruthy();
    expect(onDisk?.mirrorOf).toBe("program");
  });

  it("projects: a stale client updatedAt is replaced by the server clock", async () => {
    await projects.saveProject(makeProject("p1"));
    const onDisk = await storage.loadProject("p1");
    expect(onDisk?.updatedAt).not.toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("registry deletes leave tombstones and hide them", () => {
  it("templates: delete keeps the file with deletedAt and drops it from list/get", async () => {
    await templates.saveTemplate(makeTemplate("t1"));
    expect(await templates.deleteTemplate("t1")).toBe(true);
    const onDisk = await storage.loadTemplate("t1");
    expect(onDisk?.deletedAt).toBeTruthy();
    expect(onDisk?.updatedAt).toBe(onDisk?.deletedAt);
    expect(await templates.getTemplate("t1")).toBeNull();
    expect((await templates.listTemplateMetas()).map((t) => t.id)).not.toContain("t1");
    // Deleting again is a no-op that reports "nothing to delete".
    expect(await templates.deleteTemplate("t1")).toBe(false);
  });

  it("templates: tombstones on disk (e.g. pulled from cloud) stay hidden after reload", async () => {
    await storage.saveTemplate({
      ...makeTemplate("gone"),
      updatedAt: "2026-02-01T00:00:00.000Z",
      deletedAt: "2026-02-01T00:00:00.000Z",
    });
    await templates.reloadTemplates();
    expect(await templates.getTemplate("gone")).toBeNull();
    expect((await templates.listTemplateMetas()).map((t) => t.id)).not.toContain("gone");
    expect(await templates.duplicateTemplate("gone")).toBeNull();
  });

  it("templates: saving a tombstoned id resurrects it", async () => {
    await templates.saveTemplate(makeTemplate("t1"));
    await templates.deleteTemplate("t1");
    await templates.saveTemplate(makeTemplate("t1"));
    expect(await templates.getTemplate("t1")).not.toBeNull();
    expect((await storage.loadTemplate("t1"))?.deletedAt).toBeUndefined();
  });

  it("channel configs: delete tombstones and the list the operator sees omits it", async () => {
    await channelConfigs.saveChannelConfig(makeChannel("alpha-program"));
    expect(await channelConfigs.deleteChannelConfig("alpha-program")).toBe(true);
    expect((await storage.loadChannelConfig("alpha-program"))?.deletedAt).toBeTruthy();
    expect(await channelConfigs.getChannelConfig("alpha-program")).toBeNull();
    expect((await channelConfigs.listChannelConfigs()).map((c) => c.id)).not.toContain(
      "alpha-program",
    );
    await channelConfigs.reloadChannelConfigs();
    expect(await channelConfigs.getChannelConfig("alpha-program")).toBeNull();
  });

  it("projects: delete tombstones and hides", async () => {
    await projects.saveProject(makeProject("p1"));
    expect(await projects.deleteProject("p1")).toBe(true);
    expect((await storage.loadProject("p1"))?.deletedAt).toBeTruthy();
    expect(await projects.getProject("p1")).toBeNull();
    expect((await projects.listProjects()).map((p) => p.id)).not.toContain("p1");
  });
});

describe("list metadata and song createdAt", () => {
  const baseSong = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    title: id,
    sections: [{ id: "v1", kind: "verse", label: "Verse 1", slides: [{ id: "v1s1", lines: ["Line one"] }] }],
    defaultArrangement: ["v1"],
    customFields: {},
    ...over,
  });

  it("saveSong stamps createdAt for a new id only", async () => {
    await songs.reloadSongs();
    const created = await songs.saveSong(baseSong("s-new") as never);
    expect(created.createdAt).toBeTruthy();
    // Existing song without createdAt is never stamped.
    await storage.saveSong(baseSong("s-old") as never);
    await songs.reloadSongs();
    const old = await songs.saveSong(baseSong("s-old", { title: "edited" }) as never);
    expect(old.createdAt).toBeUndefined();
    // Existing song with createdAt keeps it even if the incoming one differs.
    const again = await songs.saveSong({ ...created, createdAt: "1999-01-01T00:00:00.000Z" } as never);
    expect(again.createdAt).toBe(created.createdAt);
  });

  it("listShowMetas includes updatedAt and totalLengthSec", async () => {
    await shows.reloadShows();
    const row = (id: string, lengthSec?: number) => ({ kind: "graphic", id, templateId: "t", data: {}, lengthSec });
    await shows.saveShow({
      id: "sh1", name: "A", projectId: "p", songs: [],
      rows: [row("r1", 120), row("r2", 30), row("r3")],
    } as never);
    await shows.saveShow({ id: "sh2", name: "B", projectId: "p", songs: [], rows: [row("r1")] } as never);
    const metas = await shows.listShowMetas();
    const a = metas.find((x) => x.id === "sh1")!;
    expect(a.totalLengthSec).toBe(150);
    expect(a.updatedAt).toBeTruthy();
    expect(metas.find((x) => x.id === "sh2")!.totalLengthSec).toBeUndefined();
  });
});

describe("duplicateShow", () => {
  it("copies sermon notes so copied row links still resolve", async () => {
    await shows.reloadShows();
    await shows.saveShow({
      id: "show-src",
      name: "Sunday",
      projectId: "p",
      songs: [],
      sermonNotes: [{ id: "n1", title: "Grace", body: "# One" }],
      rows: [{ kind: "graphic", id: "r1", templateId: "t", data: {}, sermonNotesId: "n1" }],
    });
    const copy = await shows.duplicateShow("show-src");
    expect(copy?.sermonNotes).toEqual([{ id: "n1", title: "Grace", body: "# One" }]);
    expect(copy?.rows[0]?.sermonNotesId).toBe("n1");
    // Deep copy — editing the duplicate's notes leaves the source alone.
    expect(copy?.sermonNotes?.[0]).not.toBe((await shows.getShow("show-src"))?.sermonNotes?.[0]);
  });

  it("keeps sections, sectionIds and scheduledFor with fresh row ids", async () => {
    await shows.reloadShows();
    await shows.saveShow({
      id: "show-sec",
      name: "Sunday",
      projectId: "p",
      songs: [],
      scheduledFor: "2026-11-01",
      sections: [{ id: "sec-a", name: "Worship" }],
      rows: [{ kind: "graphic", id: "r1", templateId: "t", data: {}, sectionId: "sec-a" }],
    });
    const copy = await shows.duplicateShow("show-sec");
    expect(copy?.sections).toEqual([{ id: "sec-a", name: "Worship" }]);
    expect(copy?.scheduledFor).toBe("2026-11-01");
    expect(copy?.rows[0]?.sectionId).toBe("sec-a");
    expect(copy?.rows[0]?.id).not.toBe("r1");
    expect(copy?.name).toBe("Sunday (copy)");
    expect(copy?.deletedAt).toBeUndefined();
  });
});
