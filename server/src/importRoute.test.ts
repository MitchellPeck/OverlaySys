import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import * as projects from "./projects";
import * as shows from "./shows";
import * as hotcards from "./hotcards";
import * as templates from "./templates";
import * as songs from "./songs";
import { registerImportRoutes } from "./importRoute";

/** `POST /api/import` must validate the whole body before it saves anything. */

let tmpDir: string;
let prev: Record<string, string | undefined>;
let app: FastifyInstance;

function template(id: string): Record<string, unknown> {
  return {
    id,
    name: id,
    size: { w: 1920, h: 1080 },
    fonts: [],
    fields: [],
    layers: [],
    timelines: { in: { duration: 0, tracks: [] }, out: { duration: 0, tracks: [] } },
  };
}

function song(id: string): Record<string, unknown> {
  return {
    id,
    title: id,
    sections: [{ id: "v1", kind: "verse", label: "Verse 1", slides: [{ id: "s1", lines: ["la"] }] }],
    defaultArrangement: ["v1"],
    customFields: {},
  };
}

async function jsonFiles(sub: string): Promise<string[]> {
  try {
    return (await fs.readdir(path.join(tmpDir, sub))).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-import-"));
  prev = {
    OVERLAYSYS_DATA_DIR: process.env["OVERLAYSYS_DATA_DIR"],
    OVERLAYSYS_FIXTURES_DIR: process.env["OVERLAYSYS_FIXTURES_DIR"],
  };
  process.env["OVERLAYSYS_DATA_DIR"] = tmpDir;
  process.env["OVERLAYSYS_FIXTURES_DIR"] = tmpDir;
  await projects.reloadProjects();
  await shows.reloadShows();
  await hotcards.reloadHotcards();
  await templates.reloadTemplates();
  await songs.reloadSongs();
  app = Fastify({ logger: false });
  await registerImportRoutes(app);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("POST /api/import", () => {
  it("imports a valid bundle", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/import",
      payload: { templates: [template("tpl-ok")], songs: [song("song-ok")] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, counts: { templates: 1, songs: 1 }, errors: [] });
    expect(await jsonFiles("templates")).toContain("tpl-ok.json");
    expect(await jsonFiles("songs")).toContain("song-ok.json");
  });

  it("rejects a malformed template with 400 and saves nothing, valid siblings included", async () => {
    const { layers: _layers, ...noLayers } = template("tpl-bad");
    const res = await app.inject({
      method: "POST",
      url: "/api/import",
      payload: { templates: [template("tpl-ok"), noLayers], songs: [song("song-ok")] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().ok).toBe(false);
    expect(res.json().errors[0].message).toMatch(/templates/);
    expect(await jsonFiles("templates")).not.toContain("tpl-ok.json");
    expect(await jsonFiles("templates")).not.toContain("tpl-bad.json");
    expect(await jsonFiles("songs")).not.toContain("song-ok.json");
  });

  it("rejects a non-object body and a non-array entity list", async () => {
    const a = await app.inject({ method: "POST", url: "/api/import", payload: [] });
    expect(a.statusCode).toBe(400);
    const b = await app.inject({ method: "POST", url: "/api/import", payload: { templates: "nope" } });
    expect(b.statusCode).toBe(400);
  });

  it("rejects an unsafe id with 400 and saves nothing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/import",
      payload: { templates: [template("tpl-ok"), template("../escape")] },
    });
    expect(res.statusCode).toBe(400);
    expect(await jsonFiles("templates")).not.toContain("tpl-ok.json");
    await expect(fs.stat(path.join(tmpDir, "escape.json"))).rejects.toThrow();
  });
});
