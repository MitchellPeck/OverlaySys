import { randomUUID } from "node:crypto";
import type { Show } from "@overlaysys/core";
import * as storage from "./storage";
import { normalizeAssetUrlsInShow } from "./bundleApply";

const REGISTRY = new Map<string, Show>();
let loaded = false;

export async function reloadShows(): Promise<void> {
  await storage.ensureSeeded();
  const shows = await storage.loadAllShows();
  REGISTRY.clear();
  for (const raw of shows) {
    // See templates.reloadTemplates — boot migration for absolute asset
    // URLs left over from older uploads.
    const normalized = normalizeAssetUrlsInShow(raw);
    REGISTRY.set(normalized.id, normalized);
    if (normalized !== raw) {
      await storage.saveShow(normalized);
    }
  }
  loaded = true;
}

async function ensureLoaded(): Promise<void> {
  if (!loaded) await reloadShows();
}

export async function listShowMetas(): Promise<
  { id: string; name: string; projectId: string; rowCount: number }[]
> {
  await ensureLoaded();
  return Array.from(REGISTRY.values()).map((s) => ({
    id: s.id,
    name: s.name,
    projectId: s.projectId,
    rowCount: s.rows.length,
  }));
}

export async function getShow(id: string): Promise<Show | null> {
  await ensureLoaded();
  return REGISTRY.get(id) ?? null;
}

export async function saveShow(show: Show): Promise<void> {
  const normalized = normalizeAssetUrlsInShow(show);
  await storage.saveShow(normalized);
  REGISTRY.set(normalized.id, normalized);
}

export async function deleteShow(id: string): Promise<boolean> {
  const ok = await storage.deleteShow(id);
  if (ok) REGISTRY.delete(id);
  return ok;
}

export async function duplicateShow(sourceId: string): Promise<Show | null> {
  await ensureLoaded();
  const src = REGISTRY.get(sourceId);
  if (!src) return null;
  const copy: Show = {
    id: `show-${randomUUID().slice(0, 8)}`,
    name: `${src.name} (copy)`,
    projectId: src.projectId,
    rows: src.rows.map((row) => ({ ...row, id: randomUUID() })),
    songs: src.songs,
  };
  await storage.saveShow(copy);
  REGISTRY.set(copy.id, copy);
  return copy;
}
