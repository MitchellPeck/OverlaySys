import { SongSchema, type Song, type SongMeta } from "@overlaysys/core";

/** `base`, or `base-2`, `base-3`… — the first one not in `taken`. */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
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
