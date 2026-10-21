import type { ScriptureRow, Show } from "@overlaysys/core";
import {
  breaksToSlides,
  parseReference,
  slidesToBreaks,
  tokenize,
  type ScripturePassageSource,
  type ScriptureVerse,
} from "@overlaysys/scripture";
import { broadcast } from "../broadcast";
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

let running = false;

/** Refresh every saved show once. Returns the number of shows saved. */
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
    let saved = 0;
    for (const meta of await listShowMetas()) {
      const show = await getShow(meta.id);
      if (!show) continue;
      const updated = await refreshShow(show, deps);
      if (!updated) continue;
      const stored = await saveShow(updated);
      broadcast({ type: "show", show: stored });
      saved++;
    }
    return saved;
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
