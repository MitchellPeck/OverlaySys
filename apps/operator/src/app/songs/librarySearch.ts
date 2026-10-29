import type { SongMeta } from "@overlaysys/core";
import type { SortSpec } from "@overlaysys/ui";

/** A library row: the WS meta plus whatever the HTTP library route adds. */
export interface LibraryRow extends SongMeta {
  usedIn?: number;
  usedInShows?: string[];
  /** Local server: latest past service date this song was used (YYYY-MM-DD). */
  lastUsed?: string;
  lyrics?: string;
}

/** Lowercase and strip diacritics/punctuation so "Oceans (Where Feet…)" matches "oceans where". */
export function normalizeForSearch(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Haystack for list search: title, author, CCLI number and (when loaded) lyrics. */
export function songSearchText(row: LibraryRow): string {
  return [row.title, row.author ?? "", row.ccliNumber ?? "", row.lyrics ?? ""].join(" ");
}

/** When the song was added; "" when neither stamp exists. */
export function addedAt(row: LibraryRow): string {
  return row.createdAt ?? row.updatedAt ?? "";
}

const byTitle = (a: LibraryRow, b: LibraryRow) =>
  (a.title || a.id).localeCompare(b.title || b.id, undefined, { sensitivity: "base", numeric: true });

/** Newest first; rows without a value sort last, then by title. */
function newestFirst(get: (r: LibraryRow) => string) {
  return (a: LibraryRow, b: LibraryRow) => {
    const va = get(a);
    const vb = get(b);
    if (va !== vb) {
      if (!va) return 1;
      if (!vb) return -1;
      return vb.localeCompare(va);
    }
    return byTitle(a, b);
  };
}

export const songSorts: SortSpec<LibraryRow>[] = [
  { id: "added-desc", label: "Date added", compare: newestFirst(addedAt) },
  { id: "title-asc", label: "Title", compare: byTitle },
  { id: "edited-desc", label: "Recently edited", compare: newestFirst((r) => r.updatedAt ?? "") },
  { id: "used-desc", label: "Last used", compare: newestFirst((r) => r.lastUsed ?? "") },
];

/**
 * Merge HTTP library details into the WS song list, which stays the source
 * of truth for which songs exist (it's live-updated on every save/delete).
 */
export function mergeLibrary(metas: readonly SongMeta[], details: readonly LibraryRow[] | null): LibraryRow[] {
  if (!details) return metas.slice();
  const byId = new Map(details.map((d) => [d.id, d]));
  return metas.map((m) => {
    const d = byId.get(m.id);
    return d ? { ...d, ...m, updatedAt: m.updatedAt ?? d.updatedAt, createdAt: m.createdAt ?? d.createdAt } : m;
  });
}
