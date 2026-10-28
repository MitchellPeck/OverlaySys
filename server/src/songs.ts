import type { Song, SongMeta } from "@overlaysys/core";
import * as storage from "./storage";
import { isLive, liveOnly, stampWrite, tombstone } from "./lifecycle";

const REGISTRY = new Map<string, Song>();
let loaded = false;

export async function reloadSongs(): Promise<void> {
  await storage.ensureSeeded();
  const songs = await storage.loadAllSongs();
  REGISTRY.clear();
  for (const s of songs) REGISTRY.set(s.id, s);
  loaded = true;
}

async function ensureLoaded(): Promise<void> {
  if (!loaded) await reloadSongs();
}

export async function listSongMetas(): Promise<SongMeta[]> {
  await ensureLoaded();
  return liveOnly(REGISTRY.values()).map((s) => ({
    id: s.id,
    title: s.title,
    ccliNumber: s.ccliNumber,
    author: s.author,
    updatedAt: s.updatedAt,
  }));
}

/** Tombstoned songs, newest deletion first — the library's Recently Deleted view. */
export async function listDeletedSongs(): Promise<Song[]> {
  await ensureLoaded();
  return Array.from(REGISTRY.values())
    .filter((s) => !isLive(s))
    .sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""));
}

/**
 * Bring a tombstoned song back. A fresh write (stampWrite clears deletedAt
 * and moves updatedAt forward) so the sync engine propagates the restore.
 * Returns null when the id is unknown or the song isn't deleted.
 */
export async function restoreSong(id: string): Promise<Song | null> {
  await ensureLoaded();
  const current = REGISTRY.get(id);
  if (!current || isLive(current)) return null;
  const restored = stampWrite(current);
  await storage.saveSong(restored);
  REGISTRY.set(id, restored);
  return restored;
}

/** Every id on disk, live or tombstoned — imports must not reuse a trashed id. */
export async function listAllSongIds(): Promise<string[]> {
  await ensureLoaded();
  return Array.from(REGISTRY.keys());
}

export async function getSong(id: string): Promise<Song | null> {
  await ensureLoaded();
  const s = REGISTRY.get(id);
  return s && isLive(s) ? s : null;
}

/** Full song objects — used by importers that match on ccli / customFields. */
export async function listSongs(): Promise<Song[]> {
  await ensureLoaded();
  return liveOnly(REGISTRY.values());
}

export async function saveSong(song: Song): Promise<Song> {
  await ensureLoaded();
  // See templates.saveTemplate — local writes stamp updatedAt for sync.
  // createdAt: existing record's value, else the incoming one, else now, but
  // only for an id the registry has never seen (live or tombstoned). An
  // existing song without createdAt is deliberately left without one.
  const existing = REGISTRY.get(song.id);
  const createdAt = existing
    ? existing.createdAt ?? undefined
    : song.createdAt ?? new Date().toISOString();
  const stamped = stampWrite(createdAt ? { ...song, createdAt } : { ...song, createdAt: undefined });
  await storage.saveSong(stamped);
  REGISTRY.set(stamped.id, stamped);
  return stamped;
}

export async function deleteSong(id: string): Promise<boolean> {
  await ensureLoaded();
  const current = REGISTRY.get(id);
  if (!current || !isLive(current)) return false;
  const dead = tombstone(current);
  await storage.saveSong(dead);
  REGISTRY.set(id, dead);
  return true;
}
