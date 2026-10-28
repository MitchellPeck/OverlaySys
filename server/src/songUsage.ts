import { promises as fs } from "node:fs";
import path from "node:path";
import type { Song } from "@overlaysys/core";
import { dataRoot } from "./storage";

/**
 * Song usage log for CCLI copy reporting.
 *
 * Append-only JSONL at `<dataRoot>/usage/song-usage.jsonl`, one line per
 * song that went to air. Append-only so a crash mid-write can at worst leave
 * one torn trailing line (skipped on read) and never rewrites history. Lives
 * in the data dir like every other user record, but is local-only: it isn't
 * a synced entity.
 *
 * A song's first take records a use; repeated takes of the same song within
 * {@link DEDUPE_WINDOW_MS} (re-takes, arrangement jumps, a second program
 * channel) count once, because CCLI reports count a song per service, not per
 * slide change.
 */

export interface SongUseEntry {
  /** ISO timestamp of the take. */
  at: string;
  songId: string;
  title: string;
  ccliNumber?: string;
  author?: string;
  copyright?: string;
  channel: string;
}

export const DEDUPE_WINDOW_MS = 3 * 60 * 60 * 1000;

const usageFile = (): string => path.join(dataRoot(), "usage", "song-usage.jsonl");

/** songId → last recorded time (ms). In-memory: a restart may record one extra use. */
const lastRecorded = new Map<string, number>();

/** Test hook: forget dedupe state. */
export function resetSongUsageMemory(): void {
  lastRecorded.clear();
}

/**
 * Record that `song` was taken to air on `channel`. Call for program takes
 * only (not preview/cue). Never throws: usage logging must not break a take.
 * Resolves true when a line was written, false when deduped or on error.
 */
export async function recordSongUse(
  song: Pick<Song, "id" | "title" | "ccliNumber" | "author" | "copyright">,
  channel: string,
  now: Date = new Date(),
): Promise<boolean> {
  const t = now.getTime();
  const last = lastRecorded.get(song.id);
  if (last !== undefined && t - last >= 0 && t - last < DEDUPE_WINDOW_MS) return false;
  lastRecorded.set(song.id, t);
  const entry: SongUseEntry = {
    at: now.toISOString(),
    songId: song.id,
    title: song.title,
    channel,
    ...(song.ccliNumber ? { ccliNumber: song.ccliNumber } : {}),
    ...(song.author ? { author: song.author } : {}),
    ...(song.copyright ? { copyright: song.copyright } : {}),
  };
  try {
    const file = usageFile();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, `${JSON.stringify(entry)}\n`, "utf8");
    return true;
  } catch (err) {
    console.warn("[songUsage] failed to record use", err);
    return false;
  }
}

/** Entries with `from <= at < to` (either bound optional). Torn/invalid lines are skipped. */
export async function readSongUses(range: { from?: Date; to?: Date } = {}): Promise<SongUseEntry[]> {
  let raw: string;
  try {
    raw = await fs.readFile(usageFile(), "utf8");
  } catch {
    return [];
  }
  const out: SongUseEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let e: SongUseEntry;
    try {
      e = JSON.parse(line) as SongUseEntry;
    } catch {
      continue;
    }
    if (typeof e?.at !== "string" || typeof e.songId !== "string") continue;
    const t = Date.parse(e.at);
    if (Number.isNaN(t)) continue;
    if (range.from && t < range.from.getTime()) continue;
    if (range.to && t >= range.to.getTime()) continue;
    out.push(e);
  }
  return out;
}

export interface SongUseSummary {
  songId: string;
  title: string;
  ccliNumber: string;
  author: string;
  copyright: string;
  uses: number;
  firstUsed: string;
  lastUsed: string;
}

/** One row per song, most-used first; metadata comes from the latest entry. */
export function summarizeSongUses(entries: readonly SongUseEntry[]): SongUseSummary[] {
  const by = new Map<string, SongUseSummary>();
  const sorted = entries.slice().sort((a, b) => a.at.localeCompare(b.at));
  for (const e of sorted) {
    const cur = by.get(e.songId);
    if (!cur) {
      by.set(e.songId, {
        songId: e.songId,
        title: e.title,
        ccliNumber: e.ccliNumber ?? "",
        author: e.author ?? "",
        copyright: e.copyright ?? "",
        uses: 1,
        firstUsed: e.at,
        lastUsed: e.at,
      });
      continue;
    }
    cur.uses += 1;
    cur.lastUsed = e.at;
    cur.title = e.title;
    cur.ccliNumber = e.ccliNumber ?? cur.ccliNumber;
    cur.author = e.author ?? cur.author;
    cur.copyright = e.copyright ?? cur.copyright;
  }
  return Array.from(by.values()).sort((a, b) => b.uses - a.uses || a.title.localeCompare(b.title));
}

function csvCell(v: string | number): string {
  const s = String(v);
  // Quote anything with a delimiter/quote/newline, and neutralise leading
  // formula characters so a song title can't run as a spreadsheet formula.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function songUsesToCsv(summary: readonly SongUseSummary[]): string {
  const header = ["Title", "CCLI Song #", "Author", "Copyright", "Times Used", "First Used", "Last Used"];
  const rows = summary.map((s) => [
    s.title,
    s.ccliNumber,
    s.author,
    s.copyright,
    s.uses,
    s.firstUsed.slice(0, 10),
    s.lastUsed.slice(0, 10),
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
