import { randomUUID } from "node:crypto";
import { promises as fs, constants as fsConstants } from "node:fs";
import path from "node:path";
import { migrateHeaderRows, type Show } from "@overlaysys/core";
import * as storage from "./storage";
import { normalizeAssetUrlsInShow } from "./bundleApply";
import { isLive, liveOnly, stampWrite, tombstone } from "./lifecycle";

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
  {
    id: string;
    name: string;
    projectId: string;
    rowCount: number;
    scheduledFor?: string;
    updatedAt?: string;
    totalLengthSec?: number;
  }[]
> {
  await ensureLoaded();
  return liveOnly(REGISTRY.values()).map((s) => {
    let total = 0;
    let anyLength = false;
    for (const r of s.rows) {
      if (typeof r.lengthSec === "number") {
        total += r.lengthSec;
        anyLength = true;
      }
    }
    return {
      id: s.id,
      name: s.name,
      projectId: s.projectId,
      rowCount: s.rows.length,
      scheduledFor: s.scheduledFor,
      updatedAt: s.updatedAt,
      ...(anyLength ? { totalLengthSec: total } : {}),
    };
  });
}

export async function getShow(id: string): Promise<Show | null> {
  await ensureLoaded();
  const s = REGISTRY.get(id);
  return s && isLive(s) ? s : null;
}

export async function saveShow(show: Show): Promise<Show> {
  await ensureLoaded();
  // See templates.saveTemplate — local writes stamp updatedAt for sync.
  const normalized = stampWrite(normalizeAssetUrlsInShow(show));
  await storage.saveShow(normalized);
  REGISTRY.set(normalized.id, normalized);
  return normalized;
}

export async function deleteShow(id: string): Promise<boolean> {
  await ensureLoaded();
  const current = REGISTRY.get(id);
  if (!current || !isLive(current)) return false;
  const dead = tombstone(current);
  await storage.saveShow(dead);
  REGISTRY.set(id, dead);
  return true;
}

export async function duplicateShow(sourceId: string): Promise<Show | null> {
  await ensureLoaded();
  const src = REGISTRY.get(sourceId);
  if (!src || !isLive(src)) return null;
  const { deletedAt: _deletedAt, ...rest } = src;
  const copy: Show = stampWrite<Show>({
    ...rest,
    id: `show-${randomUUID().slice(0, 8)}`,
    name: `${src.name} (copy)`,
    rows: src.rows.map((row) => ({ ...row, id: randomUUID() })),
    songs: src.songs.map((s) => ({ ...s })),
    // Copied rows keep their sermonNotesId, so the notes they point at come too.
    ...(src.sermonNotes ? { sermonNotes: src.sermonNotes.map((n) => ({ ...n })) } : {}),
    ...(src.sections ? { sections: src.sections.map((n) => ({ ...n })) } : {}),
  });
  await storage.saveShow(copy);
  REGISTRY.set(copy.id, copy);
  return copy;
}

// [P1.20] one-time PCO header-row -> section migration
/**
 * Convert PCO header rows into sections on every live show that has them.
 * The first change to a show copies its file to `<id>.json.pre-sections.bak`
 * (an existing backup is never overwritten). Returns the changed show ids.
 */
export async function applyHeaderMigration(headers: ReadonlyMap<string, string>): Promise<string[]> {
  await ensureLoaded();
  if (headers.size === 0) return [];
  const changed: string[] = [];
  for (const show of liveOnly(REGISTRY.values())) {
    const r = migrateHeaderRows(show, headers);
    if (!r.changed) continue;
    const file = path.join(storage.dataRoot(), "shows", `${show.id}.json`);
    try {
      await fs.copyFile(file, `${file}.pre-sections.bak`, fsConstants.COPYFILE_EXCL);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "ENOENT") throw err;
    }
    await saveShow(r.show);
    changed.push(show.id);
  }
  return changed;
}
// [/P1.20]
