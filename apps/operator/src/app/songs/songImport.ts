import { SongSchema, type Song, type SongMeta } from "@overlaysys/core";

/** `base`, or `base-2`, `base-3`… — the first one not in `taken`. */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/**
 * Make typed text safe as a song id (the server only accepts letters, digits,
 * `_` and `-`): lowercase, accents stripped, anything else becomes a dash.
 * A trailing dash stays so one can be typed; `finalSlug` trims it on save.
 */
export function slugInput(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-");
}

/** The slug to save with; empty when nothing usable is left. */
export function finalSlug(raw: string): string {
  return slugInput(raw).replace(/^-+|-+$/g, "");
}

/** An existing song with the same CCLI number (ignoring blanks/whitespace). */
export function findCcliDuplicate(
  ccli: string | undefined,
  songs: readonly SongMeta[],
): SongMeta | null {
  const key = ccli?.trim();
  if (!key) return null;
  return songs.find((s) => s.ccliNumber?.trim() === key) ?? null;
}

export type ImportChoice = "replace" | "copy";

/**
 * Final id for an imported song (SongSelect import spec, 2026-05-07):
 * "replace" keeps the duplicate's id; otherwise the slug is auto-suffixed so
 * an import never silently overwrites an existing (or trashed) song.
 */
export function resolveImportId(
  slug: string,
  taken: ReadonlySet<string>,
  duplicate: SongMeta | null,
  choice: ImportChoice,
): string {
  if (duplicate && choice === "replace") return duplicate.id;
  return uniqueSlug(slug, taken);
}

/**
 * Drop server-managed fields (tombstone and timestamps) from an imported
 * song.json so a file exported from the trash doesn't import tombstoned and a
 * Replace doesn't overwrite the existing song's timestamps. On Replace the
 * existing song's createdAt is kept; the server stamps updatedAt on save.
 */
export function stripServerFields(song: Song, replacing?: Pick<SongMeta, "createdAt"> | null): Song {
  const rest: Song = { ...song };
  delete rest.deletedAt;
  delete rest.createdAt;
  delete rest.updatedAt;
  return replacing?.createdAt ? { ...rest, createdAt: replacing.createdAt } : rest;
}

/** Parse an exported song JSON file, validating it with SongSchema. */
export function parseSongImportJson(text: string): { ok: true; song: Song } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file isn't valid JSON." };
  }
  const r = SongSchema.safeParse(raw);
  if (!r.success) return { ok: false, error: "This file isn't an OverlaySys song." };
  return { ok: true, song: r.data };
}
