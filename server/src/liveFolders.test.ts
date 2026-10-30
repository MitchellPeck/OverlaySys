import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LiveFolderFile } from "@overlaysys/core";
import {
  LIVE_FOLDER_SETTLE_MS,
  getLiveFolderPath,
  listLiveFolderFiles,
  onLiveFolderChange,
  registerLiveFolderRoutes,
  resolveLiveFolderFile,
  scanLiveFolderDir,
  setLiveFolderDeps,
  setLiveFolderPath,
  settleStep,
  startLiveFolderWatchers,
  stopLiveFolderWatchers,
  type ScannedFile,
} from "./liveFolders";

let tmp: string;
let folder: string;
let prev: string | undefined;
let restoreDeps: (() => void) | null = null;

beforeEach(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-livefolder-")));
  folder = path.join(tmp, "folder");
  await fs.mkdir(folder);
  prev = process.env["OVERLAYSYS_DATA_DIR"];
  process.env["OVERLAYSYS_DATA_DIR"] = path.join(tmp, "data");
});

afterEach(async () => {
  stopLiveFolderWatchers();
  restoreDeps?.();
  restoreDeps = null;
  vi.useRealTimers();
  if (prev === undefined) delete process.env["OVERLAYSYS_DATA_DIR"];
  else process.env["OVERLAYSYS_DATA_DIR"] = prev;
  await fs.rm(tmp, { recursive: true, force: true });
});

const scanned = (name: string, size: number, mtimeMs = 1): ScannedFile => ({ name, mediaType: "image", size, mtimeMs });

describe("live folders", () => {
  it("missing folder lists no files", async () => {
    expect(scanLiveFolderDir(path.join(tmp, "nope"))).toEqual([]);
    expect(listLiveFolderFiles("unset")).toEqual([]);

    await fs.writeFile(path.join(folder, "a.png"), "x");
    await setLiveFolderPath("f1", folder);
    await fs.rm(folder, { recursive: true, force: true });

    vi.useFakeTimers();
    restoreDeps = setLiveFolderDeps({ watch: () => () => {}, folderIds: async () => ["f1"] });
    await startLiveFolderWatchers();
    await vi.advanceTimersByTimeAsync(LIVE_FOLDER_SETTLE_MS + 6000);
    expect(listLiveFolderFiles("f1")).toEqual([]);
  });

  it("lists top-level images and videos only, ignoring subfolders, dotfiles and .txt", async () => {
    await fs.writeFile(path.join(folder, "a.png"), "aa");
    await fs.writeFile(path.join(folder, "b.MP4"), "bbb");
    await fs.writeFile(path.join(folder, "notes.txt"), "t");
    await fs.writeFile(path.join(folder, ".hidden.png"), "h");
    await fs.mkdir(path.join(folder, "sub"));
    await fs.writeFile(path.join(folder, "sub", "d.png"), "d");
    await fs.mkdir(path.join(folder, "dir.png"));

    const files = scanLiveFolderDir(folder);
    expect(files.map((f) => [f.name, f.mediaType, f.size])).toEqual([
      ["a.png", "image", 2],
      ["b.MP4", "video", 3],
    ]);
  });

  it("waits for a file to settle before listing it", () => {
    let state = settleStep(new Map(), [scanned("a.png", 1)], 0);
    expect(state.files).toEqual([]);
    state = settleStep(state.entries, [scanned("a.png", 2)], 1000);
    expect(state.files).toEqual([]);
    expect(state.nextDueMs).toBe(LIVE_FOLDER_SETTLE_MS);
    state = settleStep(state.entries, [scanned("a.png", 2)], 3999);
    expect(state.files).toEqual([]);
    state = settleStep(state.entries, [scanned("a.png", 2)], 4000);
    expect(state.files).toEqual([{ name: "a.png", mediaType: "image", size: 2, mtimeMs: 1 }]);
    expect(state.nextDueMs).toBeNull();
  });

  it("settles through the watcher once the file stops changing", async () => {
    vi.useFakeTimers({ now: 0 });
    let current: ScannedFile[] = [scanned("a.png", 1)];
    let fire: () => void = () => {};
    restoreDeps = setLiveFolderDeps({
      scan: () => current,
      watch: (_dir, onEvent) => {
        fire = onEvent;
        return () => {};
      },
      folderIds: async () => ["f1"],
    });
    await setLiveFolderPath("f1", folder);
    await startLiveFolderWatchers(); // first scan at t=0
    await vi.advanceTimersByTimeAsync(1000);
    current = [scanned("a.png", 2, 2)]; // grows at t=1s
    fire();
    await vi.advanceTimersByTimeAsync(2900); // t=3.9s
    expect(listLiveFolderFiles("f1")).toEqual([]);
    await vi.advanceTimersByTimeAsync(600); // t=4.5s
    expect(listLiveFolderFiles("f1")).toEqual([{ name: "a.png", mediaType: "image", size: 2, mtimeMs: 2 }]);
  });

  it("a removed file leaves the list and fires onLiveFolderChange", async () => {
    vi.useFakeTimers({ now: 0 });
    let current: ScannedFile[] = [scanned("a.png", 1), scanned("b.png", 1)];
    let fire: () => void = () => {};
    restoreDeps = setLiveFolderDeps({
      scan: () => current,
      watch: (_dir, onEvent) => {
        fire = onEvent;
        return () => {};
      },
      folderIds: async () => ["f1"],
    });
    await setLiveFolderPath("f1", folder);
    const seen: Array<[string, LiveFolderFile[]]> = [];
    const off = onLiveFolderChange((id, files) => seen.push([id, files]));
    await startLiveFolderWatchers();
    await vi.advanceTimersByTimeAsync(LIVE_FOLDER_SETTLE_MS);
    expect(listLiveFolderFiles("f1").map((f) => f.name)).toEqual(["a.png", "b.png"]);
    expect(seen.map(([id, files]) => [id, files.map((f) => f.name)])).toEqual([["f1", ["a.png", "b.png"]]]);

    current = [scanned("b.png", 1)];
    fire();
    await vi.advanceTimersByTimeAsync(500);
    expect(listLiveFolderFiles("f1").map((f) => f.name)).toEqual(["b.png"]);
    expect(seen.at(-1)?.[1].map((f) => f.name)).toEqual(["b.png"]);
    off();
  });

  it("refuses traversal and symlink escape", async () => {
    await fs.writeFile(path.join(folder, "ok.png"), "png-bytes");
    await fs.writeFile(path.join(tmp, "secret.png"), "secret");
    await fs.symlink(path.join(tmp, "secret.png"), path.join(folder, "link.png"));
    await fs.mkdir(path.join(folder, "sub"));
    await fs.writeFile(path.join(folder, "sub", "deep.png"), "deep");
    await fs.symlink(path.join(folder, "sub", "deep.png"), path.join(folder, "sublink.png"));
    await setLiveFolderPath("f1", folder);

    expect(await resolveLiveFolderFile("f1", "ok.png")).toBe(path.join(folder, "ok.png"));
    for (const bad of ["../secret.png", "..", "a/b.png", "a\\b.png", ".hidden.png", "x\0.png", "link.png", "sublink.png", "missing.png"]) {
      expect(await resolveLiveFolderFile("f1", bad)).toBeNull();
    }
    expect(await resolveLiveFolderFile("unset", "ok.png")).toBeNull();

    // Settle ok.png through the watcher (serving needs a settled file), then serve with real timers.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    restoreDeps = setLiveFolderDeps({ watch: () => () => {}, folderIds: async () => ["f1"] });
    await startLiveFolderWatchers();
    await vi.advanceTimersByTimeAsync(LIVE_FOLDER_SETTLE_MS);
    vi.useRealTimers();
    expect(listLiveFolderFiles("f1").map((f) => f.name)).toEqual(["ok.png"]);

    const app = Fastify();
    await registerLiveFolderRoutes(app);
    await app.ready();
    const ok = await app.inject({ method: "GET", url: "/media-folders/f1/ok.png" });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["content-type"]).toBe("image/png");
    expect(ok.headers["x-content-type-options"]).toBe("nosniff");
    expect(ok.body).toBe("png-bytes");
    expect((await app.inject({ method: "GET", url: "/media-folders/f1/link.png" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/media-folders/f1/sublink.png" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/media-folders/f1/..%2Fsecret.png" })).statusCode).toBe(404);
    await app.close();
  });

  it("serves only settled files: a half-copied file requested by name is 404", async () => {
    await fs.writeFile(path.join(folder, "ok.png"), "png-bytes");
    await setLiveFolderPath("f1", folder);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    restoreDeps = setLiveFolderDeps({ watch: () => () => {}, folderIds: async () => ["f1"] });
    await startLiveFolderWatchers();
    await vi.advanceTimersByTimeAsync(LIVE_FOLDER_SETTLE_MS);
    vi.useRealTimers();
    await fs.writeFile(path.join(folder, "copying.mp4"), "partial"); // not yet seen settled

    expect(await resolveLiveFolderFile("f1", "copying.mp4")).not.toBeNull();
    const app = Fastify();
    await registerLiveFolderRoutes(app);
    await app.ready();
    expect((await app.inject({ method: "GET", url: "/media-folders/f1/ok.png" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/media-folders/f1/copying.mp4" })).statusCode).toBe(404);
    await app.close();
  });

  it("path routes refuse other machines with 403", async () => {
    const app = Fastify();
    await registerLiveFolderRoutes(app);
    await app.ready();
    const remote = "192.168.1.50";
    expect((await app.inject({ method: "GET", url: "/api/media-folders/f1/path", remoteAddress: remote })).statusCode).toBe(403);
    const put = await app.inject({ method: "PUT", url: "/api/media-folders/f1/path", remoteAddress: remote, payload: { path: folder } });
    expect(put.statusCode).toBe(403);
    expect(await getLiveFolderPath("f1")).toBeNull();
    await app.close();
  });

  it("changing the configured path announces the folder once", async () => {
    const seen: Array<[string, string[]]> = [];
    const off = onLiveFolderChange((id, files) => seen.push([id, files.map((f) => f.name)]));
    // No watcher running: an empty-folder configure still announces once.
    await setLiveFolderPath("f1", folder);
    expect(seen).toEqual([["f1", []]]);
    await setLiveFolderPath("f1", null);
    expect(seen).toEqual([["f1", []], ["f1", []]]);

    // With a watched folder that has files, clearing the path emits exactly once (the watcher stop).
    await fs.writeFile(path.join(folder, "a.png"), "x");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    restoreDeps = setLiveFolderDeps({ watch: () => () => {}, folderIds: async () => ["f1"] });
    await startLiveFolderWatchers();
    await setLiveFolderPath("f1", folder);
    await vi.advanceTimersByTimeAsync(LIVE_FOLDER_SETTLE_MS);
    seen.length = 0;
    await setLiveFolderPath("f1", null);
    expect(seen).toEqual([["f1", []]]);
    off();
  });

  it("PUT path rejects a relative path and a non-directory with 400", async () => {
    await fs.writeFile(path.join(tmp, "file.png"), "x");
    const app = Fastify();
    await registerLiveFolderRoutes(app);
    await app.ready();

    expect((await app.inject({ method: "GET", url: "/api/media-folders/f1/path" })).json()).toEqual({ path: null });
    const rel = await app.inject({ method: "PUT", url: "/api/media-folders/f1/path", payload: { path: "relative/dir" } });
    expect(rel.statusCode).toBe(400);
    const notDir = await app.inject({ method: "PUT", url: "/api/media-folders/f1/path", payload: { path: path.join(tmp, "file.png") } });
    expect(notDir.statusCode).toBe(400);
    const missing = await app.inject({ method: "PUT", url: "/api/media-folders/f1/path", payload: { path: path.join(tmp, "nope") } });
    expect(missing.statusCode).toBe(400);

    const good = await app.inject({ method: "PUT", url: "/api/media-folders/f1/path", payload: { path: folder } });
    expect(good.statusCode).toBe(200);
    expect(good.json()).toEqual({ path: folder });
    expect(await getLiveFolderPath("f1")).toBe(folder);
    expect((await app.inject({ method: "GET", url: "/api/media-folders/f1/path" })).json()).toEqual({ path: folder });

    const cleared = await app.inject({ method: "PUT", url: "/api/media-folders/f1/path", payload: { path: null } });
    expect(cleared.json()).toEqual({ path: null });
    expect(await getLiveFolderPath("f1")).toBeNull();
    await app.close();
  });
});
