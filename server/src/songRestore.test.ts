import Fastify from "fastify";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SongSchema, type Song } from "@overlaysys/core";

vi.mock("./cloudSync", () => ({ scheduleSync: vi.fn() }));
vi.mock("./broadcast", () => ({ broadcast: vi.fn(), registerSender: vi.fn(() => () => {}) }));
import * as storage from "./storage";
import * as songs from "./songs";
import { registerSongLibraryRoutes } from "./songLibraryRoute";

const song = (over: Partial<Song> = {}): Song =>
  SongSchema.parse({
    id: "s1",
    title: "Placeholder Song",
    sections: [{ id: "v1", kind: "verse", label: "Verse 1", slides: [{ id: "x", lines: ["Line A"] }] }],
    defaultArrangement: ["v1"],
    ...over,
  });

describe("restoring a deleted song keeps its Added date", () => {
  let dir: string;
  let prev: string | undefined;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-song-restore-"));
    prev = process.env["OVERLAYSYS_DATA_DIR"];
    process.env["OVERLAYSYS_DATA_DIR"] = dir;
    await storage.ensureSeeded();
    await songs.reloadSongs();
  });
  afterEach(async () => {
    await storage._settleWritesForTest();
    if (prev === undefined) delete process.env["OVERLAYSYS_DATA_DIR"];
    else process.env["OVERLAYSYS_DATA_DIR"] = prev;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("POST /api/songs/:id/restore keeps createdAt, clears deletedAt, bumps updatedAt", async () => {
    await storage.saveSong(song({ createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-02-01T00:00:00.000Z" }));
    await songs.reloadSongs();
    await songs.deleteSong("s1");
    const app = Fastify();
    await registerSongLibraryRoutes(app);
    const res = await app.inject({ method: "POST", url: "/api/songs/s1/restore" });
    expect(res.json()).toEqual({ ok: true, id: "s1" });
    const s = (await songs.getSong("s1"))!;
    expect(s.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(s.deletedAt).toBeUndefined();
    expect(Date.parse(s.updatedAt!)).toBeGreaterThan(Date.parse("2026-02-01T00:00:00.000Z"));
  });

  it("a legacy song without createdAt keeps the date it showed before deletion", async () => {
    await storage.saveSong(song({ updatedAt: "2026-02-01T00:00:00.000Z" }));
    await songs.reloadSongs();
    await songs.deleteSong("s1");
    await songs.restoreSong("s1");
    expect((await songs.getSong("s1"))!.createdAt).toBe("2026-02-01T00:00:00.000Z");
  });
});
