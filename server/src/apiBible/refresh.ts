import { ShowSchema, type ScriptureRow, type Show } from "@overlaysys/core";
import {
  breaksToSlides,
  parseReference,
  slidesToBreaks,
  tokenize,
  type ScripturePassageSource,
  type ScriptureVerse,
} from "@overlaysys/scripture";
import { getShow, listShowMetas, saveShow } from "../shows";
import { getApiBibleProvider, getApiBibleStatus, initApiBible } from "./config";

// API.Bible requires stored text to be refreshed at least every 30 days; we
// refresh saved NIV rows older than 14. Offline or keyless runs change nothing.

const DAY_MS = 86_400_000;
export const STALE_MS = 14 * DAY_MS;

export interface RefreshDeps {
  now: Date;
  staleMs: number;
  fetchPassage(reference: string): Promise<{ verses: ScriptureVerse[]; source: ScripturePassageSource }>;
}

function isStale(row: ScriptureRow, deps: RefreshDeps): boolean {
  if (row.source?.provider !== "api.bible") return false;
  const at = Date.parse(row.source.fetchedAt);
  return Number.isNaN(at) || deps.now.getTime() - at > deps.staleMs;
}

async function refreshRow(row: ScriptureRow, deps: RefreshDeps): Promise<ScriptureRow | null> {
  let fresh: Awaited<ReturnType<RefreshDeps["fetchPassage"]>>;
  try {
    fresh = await deps.fetchPassage(row.reference);
  } catch {
    return null;
  }
  const source = {
    provider: "api.bible" as const,
    bibleId: fresh.source.bibleId,
    fetchedAt: deps.now.toISOString(),
    usageTokens: fresh.source.usageTokens,
  };
  const old = slidesToBreaks(row.slides);
  const words = tokenize(fresh.verses);
  // Never replace stored text with nothing — a row needs at least one slide.
  if (words.length === 0) return null;
  const same =
    words.length === old.words.length && words.every((w, i) => w.text === old.words[i]!.text);
  if (same) return { ...row, source };

  const breaks = new Set([...old.breaks].filter((b) => b > 0 && b < words.length));
  const used = new Set<string>();
  const slides = breaksToSlides(fresh.verses, words, breaks).map((s, i) => {
    let id = row.slides[i]?.id ?? `${row.id}-slide-${i}`;
    for (let n = 0; used.has(id); n++) id = `${row.id}-slide-${i}-${n}`;
    used.add(id);
    return { id, verses: s.verses };
  });
  console.info(`[api-bible] scripture row ${row.id}: NIV text changed on refresh`);
  return { ...row, slides, source };
}

/** Refresh stale API.Bible rows in one show. Returns the updated show, or null if nothing changed. */
export async function refreshShow(show: Show, deps: RefreshDeps): Promise<Show | null> {
  let changed = false;
  const rows: Show["rows"] = [];
  for (const row of show.rows) {
    if (row.kind === "scripture" && isStale(row, deps)) {
      const next = await refreshRow(row, deps);
      if (next) {
        rows.push(next);
        changed = true;
        continue;
      }
    }
    rows.push(row);
  }
  return changed ? { ...show, rows } : null;
}

export interface RefreshIo {
  listShowIds(): Promise<string[]>;
  getShow(id: string): Promise<Show | null>;
  saveShow(show: Show): Promise<void>;
}

/**
 * Apply refreshed rows onto the show as it is *now* (the fetch can take a
 * while). A row is only replaced if nobody changed it meanwhile; other rows
 * and show fields keep their current values. Null = nothing to save.
 */
export function mergeRefreshed(snapshot: Show, refreshed: Show, current: Show | null): Show | null {
  if (!current) return null;
  const refreshedById = new Map(refreshed.rows.map((r) => [r.id, r]));
  const snapshotById = new Map(snapshot.rows.map((r) => [r.id, r]));
  let applied = false;
  const rows = current.rows.map((cur) => {
    const next = refreshedById.get(cur.id);
    const snap = snapshotById.get(cur.id);
    if (!next || !snap || next === snap) return cur;
    if (JSON.stringify(cur) !== JSON.stringify(snap)) return cur;
    applied = true;
    return next;
  });
  return applied ? { ...current, rows } : null;
}

/** Refresh every show once. Returns the number of shows saved. */
export async function refreshAllShows(io: RefreshIo, deps: RefreshDeps): Promise<number> {
  let saved = 0;
  for (const id of await io.listShowIds()) {
    const snapshot = await io.getShow(id);
    if (!snapshot) continue;
    const refreshed = await refreshShow(snapshot, deps);
    if (!refreshed) continue;
    const merged = mergeRefreshed(snapshot, refreshed, await io.getShow(id));
    if (!merged) continue;
    if (!ShowSchema.safeParse(merged).success) {
      console.warn(`[api-bible] refresh produced an invalid show ${id}; not saved`);
      continue;
    }
    await io.saveShow(merged);
    saved++;
  }
  return saved;
}

let running = false;

/**
 * Refresh saved shows using the live provider. Saves quietly: no `show`
 * broadcast, so open Live/edit pages are never switched or reset — they pick
 * up refreshed text on their next load.
 */
export async function runApiBibleRefresh(now: Date = new Date()): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    if (getApiBibleStatus().state === "offline") await initApiBible();
    const provider = getApiBibleProvider();
    if (!provider) return 0;
    const deps: RefreshDeps = {
      now,
      staleMs: STALE_MS,
      fetchPassage: async (reference) => {
        const p = await provider.fetchPassage(parseReference(reference), "NIV");
        return { verses: p.verses, source: p.source! };
      },
    };
    const io: RefreshIo = {
      listShowIds: async () => (await listShowMetas()).map((m) => m.id),
      getShow,
      saveShow: async (show) => {
        await saveShow(show);
      },
    };
    return await refreshAllShows(io, deps);
  } catch (e) {
    console.warn("[api-bible] refresh failed", e instanceof Error ? e.message : e);
    return 0;
  } finally {
    running = false;
  }
}

export function startApiBibleRefresh(): () => void {
  void runApiBibleRefresh();
  const timer = setInterval(() => void runApiBibleRefresh(), DAY_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
