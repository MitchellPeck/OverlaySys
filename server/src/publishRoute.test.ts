import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import {
  BundleSchema,
  type ChannelConfig,
  type Hotcard,
  type Project,
  type Show,
  type Song,
  type Template,
} from "@overlaysys/core";
import * as storage from "./storage";
import * as projects from "./projects";
import * as shows from "./shows";
import * as hotcards from "./hotcards";
import * as templates from "./templates";
import * as songs from "./songs";
import * as channelConfigs from "./channelConfigs";
import { registerPublishRoutes } from "./publishRoute";

/**
 * `POST /api/projects/:id/publish-bundle` builds the bundle the operator
 * pushes to the cloud — from the server's own disk, so nothing depends on
 * which entities the operator happens to have cached — and re-stamps every
 * included entity so the published version is the newest one everywhere.
 */

const SHA = "a".repeat(64);
const ASSET_BYTES = Buffer.from("not-really-a-png");

let tmpDir: string;
let prev: Record<string, string | undefined>;
let app: FastifyInstance;

const tf = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, anchorX: 0, anchorY: 0 };

function template(id: string, withImage: boolean): Template {
  return {
    id,
    name: id,
    size: { w: 1920, h: 1080 },
    fonts: [],
    fields: [],
    layers: withImage
      ? [
          {
            type: "image",
            id: "img",
            name: "img",
            visible: true,
            transform: { ...tf, w: 100, h: 100 },
            src: `http://127.0.0.1:4000/assets/${SHA}.png`,
            fit: "cover",
          },
        ]
      : [],
    timelines: { in: { duration: 0, tracks: [] }, out: { duration: 0, tracks: [] } },
  };
}

function song(id: string): Song {
  return {
    id,
    title: id,
    sections: [{ id: "v1", kind: "verse", label: "Verse 1", slides: [{ id: "s1", lines: ["la"] }] }],
    defaultArrangement: ["v1"],
    customFields: {},
  };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-publish-"));
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
  await channelConfigs.reloadChannelConfigs();

  await fs.mkdir(path.join(tmpDir, "assets"), { recursive: true });
  await fs.writeFile(path.join(tmpDir, "assets", `${SHA}.png`), ASSET_BYTES);

  const now = "2026-01-01T00:00:00.000Z";
  const p1: Project = { id: "p1", name: "Sunday", createdAt: now, updatedAt: now };
  const p2: Project = { id: "p2", name: "Other", createdAt: now, updatedAt: now };
  await projects.saveProject(p1);
  await projects.saveProject(p2);
  await templates.saveTemplate(template("t1", true));
  await templates.saveTemplate(template("lyric1", false));
  await templates.saveTemplate(template("unused", false));
  await songs.saveSong(song("song1"));
  await songs.saveSong(song("song-unused"));
  const s1: Show = {
    id: "s1",
    name: "Show 1",
    projectId: "p1",
    rows: [
      { kind: "graphic", id: "r1", templateId: "t1", data: {}, channelHint: "program" },
      { kind: "song", id: "r2", songId: "song1", lyricTemplateId: "lyric1" },
    ],
    songs: [],
  };
  const s2: Show = { id: "s2", name: "Elsewhere", projectId: "p2", rows: [], songs: [] };
  await shows.saveShow(s1);
  await shows.saveShow(s2);
  const h1: Hotcard = { id: "h1", name: "Card", projectId: "p1", templateId: "t1", data: {} };
  await hotcards.saveHotcard(h1);
  const program: ChannelConfig = { id: "program", name: "Program", kind: "graphics", renderMode: "normal", background: "transparent" };
  const preview: ChannelConfig = { id: "preview", name: "Preview", kind: "graphics", renderMode: "normal", background: "transparent" };
  await channelConfigs.saveChannelConfig(program);
  await channelConfigs.saveChannelConfig(preview);

  app = Fastify({ logger: false });
  await registerPublishRoutes(app);
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

describe("POST /api/projects/:id/publish-bundle", () => {
  it("bundles the project with its dependency closure, referenced channels and asset bytes", async () => {
    const res = await app.inject({ method: "POST", url: "/api/projects/p1/publish-bundle" });
    expect(res.statusCode).toBe(200);
    const bundle = BundleSchema.parse(res.json());

    expect(bundle.project?.id).toBe("p1");
    expect(bundle.name).toBe("Sunday");
    expect(bundle.shows.map((s) => s.id)).toEqual(["s1"]);
    expect(bundle.hotcards.map((h) => h.id)).toEqual(["h1"]);
    expect(bundle.templates.map((t) => t.id).sort()).toEqual(["lyric1", "t1"]);
    expect(bundle.songs.map((s) => s.id)).toEqual(["song1"]);
    expect(bundle.channels.map((c) => c.id)).toEqual(["program"]);
    expect(bundle.assets).toHaveLength(1);
    expect(bundle.assets[0]?.filename).toBe(`${SHA}.png`);
    expect(Buffer.from(bundle.assets[0]?.data ?? "", "base64")).toEqual(ASSET_BYTES);
    expect(bundle.assets[0]?.size).toBe(ASSET_BYTES.length);
  });

  it("re-stamps every included entity and persists the stamp so local == published", async () => {
    const before = (await storage.loadProject("p1"))?.updatedAt ?? "";
    const otherBefore = (await storage.loadProject("p2"))?.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    const res = await app.inject({ method: "POST", url: "/api/projects/p1/publish-bundle" });
    const bundle = BundleSchema.parse(res.json());

    expect(bundle.project?.updatedAt! > before).toBe(true);
    expect((await storage.loadProject("p1"))?.updatedAt).toBe(bundle.project?.updatedAt);
    for (const s of bundle.shows) {
      expect((await storage.loadShow(s.id))?.updatedAt).toBe(s.updatedAt);
    }
    for (const t of bundle.templates) {
      expect((await storage.loadTemplate(t.id))?.updatedAt).toBe(t.updatedAt);
    }
    for (const c of bundle.channels) {
      expect((await storage.loadChannelConfig(c.id))?.updatedAt).toBe(c.updatedAt);
    }
    // Entities outside the project are untouched.
    expect((await storage.loadProject("p2"))?.updatedAt).toBe(otherBefore);
    expect((await storage.loadTemplate("unused"))?.updatedAt! < bundle.project!.updatedAt).toBe(true);
  });

  it("404s for a project that does not exist", async () => {
    const res = await app.inject({ method: "POST", url: "/api/projects/nope/publish-bundle" });
    expect(res.statusCode).toBe(404);
  });

  it("skips a referenced asset that is missing on disk instead of failing the bundle", async () => {
    await fs.rm(path.join(tmpDir, "assets", `${SHA}.png`));
    const res = await app.inject({ method: "POST", url: "/api/projects/p1/publish-bundle" });
    expect(res.statusCode).toBe(200);
    const bundle = BundleSchema.parse(res.json());
    expect(bundle.assets).toEqual([]);
    expect(bundle.templates.map((t) => t.id).sort()).toEqual(["lyric1", "t1"]);
  });
});
