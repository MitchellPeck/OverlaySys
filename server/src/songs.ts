import type { Song, SongMeta } from "@overlaysys/core";
import * as storage from "./storage";

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
  return Array.from(REGISTRY.values()).map((s) => ({
    id: s.id,
    title: s.title,
    ccliNumber: s.ccliNumber,
    author: s.author,
  }));
}

export async function getSong(id: string): Promise<Song | null> {
  await ensureLoaded();
  return REGISTRY.get(id) ?? null;
}

export async function saveSong(song: Song): Promise<void> {
  await storage.saveSong(song);
  REGISTRY.set(song.id, song);
}

export async function deleteSong(id: string): Promise<boolean> {
  const ok = await storage.deleteSong(id);
  if (ok) REGISTRY.delete(id);
  return ok;
}
