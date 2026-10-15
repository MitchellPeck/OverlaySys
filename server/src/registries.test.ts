import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ChannelConfig, Project, Template } from "@overlaysys/core";
import * as storage from "./storage";
import * as templates from "./templates";
import * as channelConfigs from "./channelConfigs";
import * as projects from "./projects";

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
  return { id, name: id, renderMode: "matte", mirrorOf: "program", background: "transparent" };
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
