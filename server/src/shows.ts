import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
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
export interface HeaderMigrationOpts {
  /** True when this row is currently live on any channel; its show is skipped this pass. */
  isRowLive?: (showId: string, rowId: string) => boolean;
  /** Called with the saved shows after a pass that changed something. */
  onChanged?: (saved: Show[]) => Promise<void> | void;
  /** Called for a show left alone because a header row to remove is live. */
  onSkipped?: (showId: string) => void;
}

async function backupOnce(file: string): Promise<void> {
  const bak = `${file}.pre-sections.bak`;
  const tmp = `${bak}.tmp`;
  try {
    await fs.copyFile(file, tmp);
    // link() fails with EEXIST, so an existing backup is never replaced, and a
    // crash mid-copy leaves only the .tmp, never a truncated .bak.
    await fs.link(tmp, bak);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") console.warn(`[shows] header migration: no file at ${file}; migrating without a backup`);
    else if (code !== "EEXIST") throw err;
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

/**
 * Convert PCO header rows into sections on every live show that has them.
 * The first change to a show copies its file to `<id>.json.pre-sections.bak`
 * (an existing backup is never overwritten). The show is re-read after the
 * backup and saved with no await in between, so a concurrent save is not lost.
 * Returns the changed show ids.
 */
export async function applyHeaderMigration(
  headers: ReadonlyMap<string, string>,
  opts: HeaderMigrationOpts = {},
): Promise<string[]> {
  await ensureLoaded();
  if (headers.size === 0) return [];
  const headerRowIds = (show: Show): string[] =>
    show.rows.flatMap((r) =>
      r.kind === "graphic" && r.sourceRef?.provider === "pco" && headers.has(r.sourceRef.itemId) ? [r.id] : [],
    );
  const blocked = (show: Show): boolean =>
    headerRowIds(show).some((rowId) => opts.isRowLive?.(show.id, rowId) === true);
  const changed: string[] = [];
  const saved: Show[] = [];
  for (const candidate of liveOnly(REGISTRY.values())) {
    if (!migrateHeaderRows(candidate, headers).changed) continue;
    if (blocked(candidate)) {
      opts.onSkipped?.(candidate.id);
      continue;
    }
    await backupOnce(path.join(storage.dataRoot(), "shows", `${candidate.id}.json`));
    // Re-read: the show may have been edited, deleted or gone live during the backup.
    const current = REGISTRY.get(candidate.id);
    if (!current || !isLive(current)) continue;
    const r = migrateHeaderRows(current, headers);
    if (!r.changed) continue;
    if (blocked(current)) {
      opts.onSkipped?.(current.id);
      continue;
    }
    saved.push(await saveShow(r.show)); // no await between the re-read and this call
    changed.push(current.id);
  }
  if (saved.length > 0) await opts.onChanged?.(saved);
  return changed;
}
// [/P1.20]
