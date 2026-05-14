import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { DEFAULT_PROJECT_ID, type Project } from "@overlaysys/core";
import * as storage from "./storage";

let tmpDir: string;
let prevDataDir: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-projects-"));
  prevDataDir = process.env["OVERLAYSYS_DATA_DIR"];
  process.env["OVERLAYSYS_DATA_DIR"] = tmpDir;
});

afterEach(async () => {
  if (prevDataDir === undefined) delete process.env["OVERLAYSYS_DATA_DIR"];
  else process.env["OVERLAYSYS_DATA_DIR"] = prevDataDir;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeProject(id: string): Project {
  return {
    id,
    name: id,
    createdAt: "2026-05-14T00:00:00.000Z",
    updatedAt: "2026-05-14T00:00:00.000Z",
  };
}

describe("project storage CRUD", () => {
  it("saves and loads a project by id", async () => {
    await storage.saveProject(makeProject("sunday"));
    const got = await storage.loadProject("sunday");
    expect(got?.name).toBe("sunday");
  });

  it("returns null for a missing project", async () => {
    const got = await storage.loadProject("nope");
    expect(got).toBeNull();
  });

  it("lists all saved projects", async () => {
    await storage.saveProject(makeProject("a"));
    await storage.saveProject(makeProject("b"));
    const all = await storage.loadAllProjects();
    expect(all.map((p) => p.id).sort()).toEqual(["a", "b"]);
  });

  it("deletes a project", async () => {
    await storage.saveProject(makeProject("temp"));
    const ok = await storage.deleteProject("temp");
    expect(ok).toBe(true);
    expect(await storage.loadProject("temp")).toBeNull();
  });

  it("ensureSeeded creates the default project when none exist", async () => {
    await storage.ensureSeeded();
    const def = await storage.loadProject(DEFAULT_PROJECT_ID);
    expect(def?.id).toBe(DEFAULT_PROJECT_ID);
  });

  it("ensureSeeded leaves an existing default project untouched", async () => {
    const custom = { ...makeProject(DEFAULT_PROJECT_ID), name: "Custom Default" };
    await storage.saveProject(custom);
    await storage.ensureSeeded();
    const def = await storage.loadProject(DEFAULT_PROJECT_ID);
    expect(def?.name).toBe("Custom Default");
  });
});
