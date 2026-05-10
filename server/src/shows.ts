import type { Show } from "@overlaysys/core";
import * as storage from "./storage";

const REGISTRY = new Map<string, Show>();
let loaded = false;

export async function reloadShows(): Promise<void> {
  await storage.ensureSeeded();
  const shows = await storage.loadAllShows();
  REGISTRY.clear();
  for (const s of shows) REGISTRY.set(s.id, s);
  loaded = true;
}

async function ensureLoaded(): Promise<void> {
  if (!loaded) await reloadShows();
}

export async function listShowMetas(): Promise<
  { id: string; name: string; rowCount: number }[]
> {
  await ensureLoaded();
  return Array.from(REGISTRY.values()).map((s) => ({
    id: s.id,
    name: s.name,
    rowCount: s.rows.length,
  }));
}

export async function getShow(id: string): Promise<Show | null> {
  await ensureLoaded();
  return REGISTRY.get(id) ?? null;
}

export async function saveShow(show: Show): Promise<void> {
  await storage.saveShow(show);
  REGISTRY.set(show.id, show);
}

export async function deleteShow(id: string): Promise<boolean> {
  const ok = await storage.deleteShow(id);
  if (ok) REGISTRY.delete(id);
  return ok;
}
