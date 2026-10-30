import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { LiveFolderFile } from "@overlaysys/core";
import { dataRoot } from "./storage";
import { mimeFromFilename } from "./assets";
import { isLocalAddress, remoteAddressOf, securityContext } from "./security";
import { listLiveFolderItemIds } from "./media";

/**
 * Live folders: a media item that plays whatever images and videos sit in a
 * folder on this machine. The folder path is per machine
 * (`settings/media-folders.json`), never synced and never sent to renderers;
 * files are served at `/media-folders/<id>/<name>`.
 *
 * A file is listed only once its size and mtime have held still for
 * LIVE_FOLDER_SETTLE_MS, so a half-copied video never goes to air.
 */

export const LIVE_FOLDER_SETTLE_MS = 3000;
export const LIVE_FOLDER_POLL_MS = 5000;
/** fs.watch fires in bursts while a file is copied; rescan once per burst. */
const WATCH_DEBOUNCE_MS = 200;

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "m4v"]);

export type ScannedFile = LiveFolderFile;

/** The media type of a live-folder file name, or null when it is not listed (dotfile or other extension). */
export function liveFolderMediaType(name: string): "image" | "video" | null {
  if (name.startsWith(".")) return null;
  const ext = path.extname(name).slice(1).toLowerCase();
  if (IMAGE_EXT.has(ext)) return "image";
  if (VIDEO_EXT.has(ext)) return "video";
  return null;
}

/** Top-level image and video files of `dir`, by name. [] when the folder is missing or unreadable. */
export function scanLiveFolderDir(dir: string): ScannedFile[] {
  let entries: fsSync.Dirent[];
  try {
    entries = fsSync.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: ScannedFile[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const mediaType = liveFolderMediaType(e.name);
    if (!mediaType) continue;
    try {
      const st = fsSync.statSync(path.join(dir, e.name));
      out.push({ name: e.name, mediaType, size: st.size, mtimeMs: st.mtimeMs });
    } catch {
      /* removed between readdir and stat */
    }
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// ── Settle state machine (pure) ─────────────────────────────────────────────

export type SettleEntry = ScannedFile & { since: number };

export type SettleResult = {
  entries: Map<string, SettleEntry>;
  /** Files whose size and mtime have held for LIVE_FOLDER_SETTLE_MS, by name. */
  files: LiveFolderFile[];
  /** Ms until the next unsettled file could settle, or null when all are settled. */
  nextDueMs: number | null;
};

/** Fold one scan into the per-file settle state at time `now`. */
export function settleStep(prev: Map<string, SettleEntry>, scan: ScannedFile[], now: number): SettleResult {
  const entries = new Map<string, SettleEntry>();
  const files: LiveFolderFile[] = [];
  let nextDueMs: number | null = null;
  for (const f of scan) {
    const old = prev.get(f.name);
    const unchanged = old !== undefined && old.size === f.size && old.mtimeMs === f.mtimeMs && old.mediaType === f.mediaType;
    const since = unchanged ? old.since : now;
    entries.set(f.name, { ...f, since });
    const left = since + LIVE_FOLDER_SETTLE_MS - now;
    if (left <= 0) files.push({ name: f.name, mediaType: f.mediaType, size: f.size, mtimeMs: f.mtimeMs });
    else nextDueMs = nextDueMs === null ? left : Math.min(nextDueMs, left);
  }
  files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { entries, files, nextDueMs };
}

function sameFiles(a: LiveFolderFile[], b: LiveFolderFile[]): boolean {
  return (
    a.length === b.length &&
    a.every((f, i) => {
      const g = b[i]!;
      return f.name === g.name && f.size === g.size && f.mtimeMs === g.mtimeMs && f.mediaType === g.mediaType;
    })
  );
}

// ── Per-machine path settings ───────────────────────────────────────────────

type PathMap = Record<string, { path: string }>;

const settingsFile = (): string => path.join(dataRoot(), "settings", "media-folders.json");

async function loadPaths(): Promise<PathMap> {
  try {
    const raw = JSON.parse(await fs.readFile(settingsFile(), "utf8")) as unknown;
    if (!raw || typeof raw !== "object") return {};
    const out: PathMap = {};
    for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
      const p = (v as { path?: unknown } | null)?.path;
      if (typeof p === "string" && p) out[id] = { path: p };
    }
    return out;
  } catch {
    return {};
  }
}

export async function getLiveFolderPath(id: string): Promise<string | null> {
  return (await loadPaths())[id]?.path ?? null;
}

function badRequest(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 400 });
}

/** Set or clear this machine's folder for a live folder. The path must be an absolute, existing directory. */
export async function setLiveFolderPath(id: string, dir: string | null): Promise<void> {
  if (dir !== null) {
    if (typeof dir !== "string" || !path.isAbsolute(dir)) throw badRequest("path must be absolute");
    const st = await fs.stat(dir).catch(() => null);
    if (!st?.isDirectory()) throw badRequest("path is not a folder");
  }
  const paths = await loadPaths();
  if (dir === null) delete paths[id];
  else paths[id] = { path: dir };
  await fs.mkdir(path.dirname(settingsFile()), { recursive: true });
  await fs.writeFile(settingsFile(), JSON.stringify(paths, null, 2));
  // Tell every console that `configured` changed — once: if the re-sync
  // already emitted for this folder, that emit carries the new state.
  const before = emitSeq.get(id) ?? 0;
  await syncLiveFolderWatchers();
  if ((emitSeq.get(id) ?? 0) === before) emit(id, listLiveFolderFiles(id));
}

// ── Safe file resolution ────────────────────────────────────────────────────

/** Absolute real path of a live-folder file, or null when the name is unsafe, unlisted or outside the folder. */
export async function resolveLiveFolderFile(id: string, name: string): Promise<string | null> {
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..") || name.includes("\0")) return null;
  if (!liveFolderMediaType(name)) return null; // also rejects a leading "."
  const dir = await getLiveFolderPath(id);
  if (!dir) return null;
  try {
    const realDir = await fs.realpath(dir);
    const real = await fs.realpath(path.join(dir, name));
    // Top level only: a symlink into a subfolder (or out of the folder) is refused.
    if (path.dirname(real) !== realDir) return null;
    if (!(await fs.stat(real)).isFile()) return null;
    return real;
  } catch {
    return null;
  }
}

// ── Watching ────────────────────────────────────────────────────────────────

export type LiveFolderDeps = {
  now: () => number;
  scan: (dir: string) => ScannedFile[];
  /** Start watching `dir`; returns a stop function. Must never throw. */
  watch: (dir: string, onEvent: () => void) => () => void;
  /** Ids of the live-folder media items. */
  folderIds: () => Promise<string[]>;
};

function fsWatch(dir: string, onEvent: () => void): () => void {
  try {
    const w = fsSync.watch(dir, { persistent: false }, () => onEvent());
    w.on("error", () => {
      /* the folder went away; polling keeps the list right */
    });
    return () => w.close();
  } catch {
    return () => {};
  }
}

const defaultDeps: LiveFolderDeps = {
  now: () => Date.now(),
  scan: scanLiveFolderDir,
  watch: fsWatch,
  folderIds: listLiveFolderItemIds,
};
let deps: LiveFolderDeps = defaultDeps;

/** Test hook: override dependencies; returns a function that restores the previous ones. */
export function setLiveFolderDeps(over: Partial<LiveFolderDeps>): () => void {
  const before = deps;
  deps = { ...deps, ...over };
  return () => {
    deps = before;
  };
}

type FolderWatch = {
  dir: string;
  entries: Map<string, SettleEntry>;
  files: LiveFolderFile[];
  unwatch: () => void;
  settleTimer: NodeJS.Timeout | null;
  debounceTimer: NodeJS.Timeout | null;
};

const watches = new Map<string, FolderWatch>();
const listeners = new Set<(id: string, files: LiveFolderFile[]) => void>();
let running = false;
let pollTimer: NodeJS.Timeout | null = null;
let syncChain: Promise<void> = Promise.resolve();

export function onLiveFolderChange(cb: (id: string, files: LiveFolderFile[]) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Per-folder emit counter, so setLiveFolderPath can tell whether a re-sync already announced it. */
const emitSeq = new Map<string, number>();

function emit(id: string, files: LiveFolderFile[]): void {
  emitSeq.set(id, (emitSeq.get(id) ?? 0) + 1);
  for (const cb of listeners) {
    try {
      cb(id, files);
    } catch (err) {
      console.warn("[liveFolders] listener threw", err);
    }
  }
}

/** Settled files of a live folder; [] when its path is unset, missing or unreadable. */
export function listLiveFolderFiles(id: string): LiveFolderFile[] {
  return watches.get(id)?.files ?? [];
}

function rescan(id: string): void {
  const w = watches.get(id);
  if (!w) return;
  const step = settleStep(w.entries, deps.scan(w.dir), deps.now());
  w.entries = step.entries;
  if (w.settleTimer) clearTimeout(w.settleTimer);
  w.settleTimer = step.nextDueMs === null ? null : setTimeout(() => rescan(id), step.nextDueMs);
  if (!sameFiles(w.files, step.files)) {
    w.files = step.files;
    emit(id, step.files);
  }
}

function startWatch(id: string, dir: string): void {
  const w: FolderWatch = { dir, entries: new Map(), files: [], unwatch: () => {}, settleTimer: null, debounceTimer: null };
  watches.set(id, w);
  w.unwatch = deps.watch(dir, () => {
    if (w.debounceTimer) return;
    w.debounceTimer = setTimeout(() => {
      w.debounceTimer = null;
      rescan(id);
    }, WATCH_DEBOUNCE_MS);
  });
  rescan(id);
}

function stopWatch(id: string): void {
  const w = watches.get(id);
  if (!w) return;
  watches.delete(id);
  w.unwatch();
  if (w.settleTimer) clearTimeout(w.settleTimer);
  if (w.debounceTimer) clearTimeout(w.debounceTimer);
  if (w.files.length > 0) emit(id, []);
}

async function syncOnce(): Promise<void> {
  if (!running) return;
  const [ids, paths] = await Promise.all([deps.folderIds(), loadPaths()]);
  if (!running) return;
  const want = new Map<string, string>();
  for (const id of ids) {
    const p = paths[id]?.path;
    if (p) want.set(id, p);
  }
  for (const [id, w] of [...watches]) if (want.get(id) !== w.dir) stopWatch(id);
  for (const [id, dir] of want) if (!watches.has(id)) startWatch(id, dir);
}

/** Bring the watcher set in line with the live-folder items and configured paths. No-op until started. */
export function syncLiveFolderWatchers(): Promise<void> {
  syncChain = syncChain.then(syncOnce).catch((err) => console.warn("[liveFolders] sync failed", err));
  return syncChain;
}

/**
 * Watch every live-folder item that has a path on this machine. A 5 s poll
 * rescans each folder (fs.watch misses events on some volumes) and re-syncs
 * the watcher set, so items pulled from the cloud are picked up too.
 */
export async function startLiveFolderWatchers(): Promise<void> {
  if (running) return syncLiveFolderWatchers();
  running = true;
  pollTimer = setInterval(() => {
    void syncLiveFolderWatchers().then(() => {
      for (const id of watches.keys()) rescan(id);
    });
  }, LIVE_FOLDER_POLL_MS);
  pollTimer.unref?.();
  await syncLiveFolderWatchers();
}

export function stopLiveFolderWatchers(): void {
  running = false;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  for (const id of [...watches.keys()]) stopWatch(id);
}

// ── HTTP ────────────────────────────────────────────────────────────────────

/** `bytes=a-b` → [start, end] within `size`, or null when absent/unsatisfiable. */
function parseRange(header: string | undefined, size: number): [number, number] | null {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start: number;
  let end: number;
  if (m[1] === "") {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start <= end && start < size ? [start, end] : null;
}

/** The folder path is per machine and never leaves it: refuse (403) any peer that is not this machine. Returns true when refused. */
function requireLocal(req: FastifyRequest, reply: FastifyReply): boolean {
  if (isLocalAddress(remoteAddressOf(req.raw), securityContext().ownAddresses)) return false;
  void reply.code(403).send({ error: "only allowed from this machine" });
  return true;
}

export async function registerLiveFolderRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>("/api/media-folders/:id/path", async (req, reply) => {
    if (requireLocal(req, reply)) return reply;
    return { path: await getLiveFolderPath(req.params.id) };
  });

  app.put<{ Params: { id: string }; Body: { path?: unknown } }>("/api/media-folders/:id/path", async (req, reply) => {
    if (requireLocal(req, reply)) return reply;
    const p = req.body?.path ?? null;
    if (p !== null && typeof p !== "string") return reply.code(400).send({ message: "path must be a string or null" });
    try {
      await setLiveFolderPath(req.params.id, p);
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 400) return reply.code(400).send({ message: (err as Error).message });
      throw err;
    }
    return { path: p };
  });

  app.get<{ Params: { id: string; file: string } }>("/media-folders/:id/:file", async (req, reply) => {
    // Only settled files: a half-copied file requested by name is not served.
    const settled = listLiveFolderFiles(req.params.id).some((f) => f.name === req.params.file);
    const real = settled ? await resolveLiveFolderFile(req.params.id, req.params.file) : null;
    if (!real) return reply.code(404).send({ error: "not found" });
    const st = await fs.stat(real).catch(() => null);
    if (!st) return reply.code(404).send({ error: "not found" });
    reply
      .header("Content-Type", mimeFromFilename(real) || "application/octet-stream")
      .header("X-Content-Type-Options", "nosniff")
      .header("Accept-Ranges", "bytes")
      .header("Cache-Control", "no-cache");
    const range = req.headers.range ? parseRange(req.headers.range, st.size) : null;
    if (req.headers.range && !range) {
      return reply.code(416).header("Content-Range", `bytes */${st.size}`).send();
    }
    if (range) {
      const [start, end] = range;
      reply.code(206).header("Content-Range", `bytes ${start}-${end}/${st.size}`).header("Content-Length", end - start + 1);
      return reply.send(fsSync.createReadStream(real, { start, end }));
    }
    reply.header("Content-Length", st.size);
    return reply.send(fsSync.createReadStream(real));
  });
}
