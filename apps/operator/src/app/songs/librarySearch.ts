import type { SongMeta } from "@overlaysys/core";

/** A library row: the WS meta plus whatever the HTTP library route adds. */
export interface LibraryRow extends SongMeta {
  usedIn?: number;
  usedInShows?: string[];
  lyrics?: string;
}

export type LibrarySort = "title" | "recent";

/** Lowercase and strip diacritics/punctuation so "Oceans (Where Feet…)" matches "oceans where". */
export function normalizeForSearch(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Every whitespace-separated term must appear in the title, author, CCLI
 * number or (when loaded) the lyrics.
 */
export function songMatches(row: LibraryRow, query: string): boolean {
  const terms = normalizeForSearch(query).split(" ").filter(Boolean);
  if (terms.length === 0) return true;
  const hay = normalizeForSearch(
    [row.title, row.author ?? "", row.ccliNumber ?? "", row.lyrics ?? ""].join(" "),
  );
  return terms.every((t) => hay.includes(t));
}

export function sortLibrary<T extends LibraryRow>(rows: readonly T[], sort: LibrarySort): T[] {
  const byTitle = (a: T, b: T) =>
    (a.title || a.id).localeCompare(b.title || b.id, undefined, { sensitivity: "base", numeric: true });
  const out = rows.slice();
  if (sort === "title") return out.sort(byTitle);
  // Recently edited: newest first; songs never stamped sort last, by title.
  return out.sort((a, b) => {
    const ua = a.updatedAt ?? "";
    const ub = b.updatedAt ?? "";
    if (ua !== ub) return ub.localeCompare(ua);
    return byTitle(a, b);
  });
}

/**
 * Merge HTTP library details into the WS song list, which stays the source
 * of truth for which songs exist (it's live-updated on every save/delete).
 */
export function mergeLibrary(metas: readonly SongMeta[], details: readonly LibraryRow[] | null): LibraryRow[] {
  if (!details) return metas.slice();
  const byId = new Map(details.map((d) => [d.id, d]));
  return metas.map((m) => {
    const d = byId.get(m.id);
    return d ? { ...d, ...m, updatedAt: m.updatedAt ?? d.updatedAt } : m;
  });
}
