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
  }));
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
  const stamped = stampWrite(song);
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
