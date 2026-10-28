// Pure model behind LibraryList: search, sort, filter, persisted prefs,
// keyboard helpers and the body state. No React, no DOM.

export type SortSpec<T> = { id: string; label: string; compare(a: T, b: T): number };
export type FilterSpec<T> = {
  id: string;
  label: string;
  options: { value: string; label: string }[];
  test(item: T, value: string): boolean;
};

export type ListView = "list" | "grid";
export type ListPrefs = { sort: string; filters: Record<string, string>; view: ListView };

/** NFKD, strip diacritics, lowercase, non-alphanumerics → space, trim/collapse. */
export function normalizeSearch(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** A filter value of "" or "all" means "no filter". */
export function isActiveFilterValue(v: string | undefined): v is string {
  return v !== undefined && v !== "" && v !== "all";
}

export function computeVisible<T>(i: {
  items: T[];
  query: string;
  searchText(t: T): string;
  sorts: SortSpec<T>[];
  sortId: string;
  filters?: FilterSpec<T>[];
  filterValues: Record<string, string>;
}): T[] {
  const terms = normalizeSearch(i.query).split(" ").filter(Boolean);
  const active = (i.filters ?? []).filter((f) => isActiveFilterValue(i.filterValues[f.id]));
  const out = i.items.filter((t) => {
    for (const f of active) if (!f.test(t, i.filterValues[f.id]!)) return false;
    if (terms.length === 0) return true;
    const hay = normalizeSearch(i.searchText(t));
    return terms.every((term) => hay.includes(term));
  });
  const sort = i.sorts.find((s) => s.id === i.sortId);
  // Array.prototype.sort is stable (ES2019); `out` is already a fresh array.
  return sort ? out.sort((a, b) => sort.compare(a, b)) : out;
}

export const LIST_PREFS_PREFIX = "overlaysys.list.";

export function loadListPrefs(
  storage: Pick<Storage, "getItem"> | null,
  key: string,
  d: { sortIds: string[]; defaultSort: string; filters?: FilterSpec<unknown>[]; gridAvailable: boolean },
): ListPrefs {
  const prefs: ListPrefs = { sort: d.defaultSort, filters: {}, view: "list" };
  let raw: unknown;
  try {
    const text = storage?.getItem(LIST_PREFS_PREFIX + key);
    if (!text) return prefs;
    raw = JSON.parse(text);
  } catch {
    return prefs;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return prefs;
  const r = raw as Record<string, unknown>;
  if (typeof r.sort === "string" && d.sortIds.includes(r.sort)) prefs.sort = r.sort;
  if (r.view === "grid" && d.gridAvailable) prefs.view = "grid";
  if (r.filters && typeof r.filters === "object" && !Array.isArray(r.filters)) {
    for (const [id, v] of Object.entries(r.filters as Record<string, unknown>)) {
      const f = d.filters?.find((x) => x.id === id);
      if (f && typeof v === "string" && f.options.some((o) => o.value === v)) prefs.filters[id] = v;
    }
  }
  return prefs;
}

export function saveListPrefs(
  storage: Pick<Storage, "setItem"> | null,
  key: string,
  prefs: ListPrefs,
): void {
  try {
    storage?.setItem(LIST_PREFS_PREFIX + key, JSON.stringify(prefs));
  } catch {
    // Private mode / quota: prefs are a convenience, never an error.
  }
}

/** Next selected id for ↑/↓ (clamps at the ends; null current → first/last). */
export function moveSelection(ids: string[], current: string | null, delta: 1 | -1): string | null {
  if (ids.length === 0) return null;
  const at = current === null ? -1 : ids.indexOf(current);
  if (at === -1) return delta === 1 ? ids[0]! : ids[ids.length - 1]!;
  return ids[Math.max(0, Math.min(ids.length - 1, at + delta))]!;
}

const TEXT_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/** Typing a printable character on the list (not in a field) jumps to search. */
export function shouldFocusSearch(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  targetTag: string;
  targetEditable: boolean;
}): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (TEXT_TAGS.has(e.targetTag.toUpperCase()) || e.targetEditable) return false;
  // One code point, not whitespace (Space activates the focused control).
  return [...e.key].length === 1 && /\S/u.test(e.key);
}

export type ListBodyState = "loading" | "error" | "empty" | "no-match" | "list";

/** error > loading > empty > no-match > list. Offline never reads as "No songs yet". */
export function listBodyState(i: {
  loading?: boolean;
  error?: string | null;
  total: number;
  visible: number;
}): ListBodyState {
  if (i.error) return "error";
  if (i.loading) return "loading";
  if (i.total === 0) return "empty";
  if (i.visible === 0) return "no-match";
  return "list";
}
