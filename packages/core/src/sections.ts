import type { RundownRow, Show, ShowSection } from "./show";

export type SectionGroup = { section: ShowSection | null; rows: RundownRow[] };

/** Sections with duplicate ids dropped (first wins). */
function uniqueSections(show: Show): ShowSection[] {
  const seen = new Set<string>();
  const out: ShowSection[] = [];
  for (const s of show.sections ?? []) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}

/**
 * Rows grouped for display: the "no section" group first (included when it has
 * rows or when the show has no sections), then every section in order (empty
 * ones too). Rows whose `sectionId` is unknown fall into the "no section" group.
 */
export function groupRowsBySection(show: Show): SectionGroup[] {
  const sections = uniqueSections(show);
  const known = new Set(sections.map((s) => s.id));
  const none: RundownRow[] = [];
  const bySection = new Map<string, RundownRow[]>(sections.map((s) => [s.id, []]));
  for (const row of show.rows) {
    const id = row.sectionId;
    if (id !== undefined && known.has(id)) bySection.get(id)!.push(row);
    else none.push(row);
  }
  const groups: SectionGroup[] = [];
  if (none.length > 0 || sections.length === 0) groups.push({ section: null, rows: none });
  for (const s of sections) groups.push({ section: s, rows: bySection.get(s.id)! });
  return groups;
}

function sameArray<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Flatten groups back into a show; returns `show` itself when nothing changed. */
function rebuild(show: Show, groups: SectionGroup[]): Show {
  const rows = groups.flatMap((g) => g.rows);
  const named = groups.flatMap((g) => (g.section ? [g.section] : []));
  const sectionsSame = show.sections === undefined ? named.length === 0 : sameArray(show.sections, named);
  if (sectionsSame && sameArray(show.rows, rows)) return show;
  const { sections: _drop, ...rest } = show;
  return named.length > 0 ? { ...rest, sections: named, rows } : { ...rest, rows };
}

function withSection(row: RundownRow, sectionId: string | null): RundownRow {
  if (sectionId === null) {
    if (!("sectionId" in row)) return row;
    const { sectionId: _d, ...rest } = row;
    return rest as RundownRow;
  }
  return row.sectionId === sectionId ? row : ({ ...row, sectionId } as RundownRow);
}

function ensureNoneGroup(groups: SectionGroup[]): SectionGroup {
  let g = groups.find((x) => x.section === null);
  if (!g) {
    g = { section: null, rows: [] };
    groups.unshift(g);
  }
  return g;
}

function clamp(n: number, max: number): number {
  if (!Number.isFinite(n)) return n > 0 ? max : 0;
  return Math.max(0, Math.min(Math.trunc(n), max));
}

export function orderRowsBySection(show: Show): Show {
  return rebuild(show, groupRowsBySection(show));
}

function place(
  show: Show,
  row: RundownRow,
  toSectionId: string | null,
  toIndex: number,
  groups: SectionGroup[],
): Show {
  const target =
    toSectionId === null ? ensureNoneGroup(groups) : groups.find((g) => g.section?.id === toSectionId);
  if (!target) return show;
  target.rows.splice(clamp(toIndex, target.rows.length), 0, withSection(row, toSectionId));
  return rebuild(show, groups);
}

function hasSection(show: Show, id: string): boolean {
  return uniqueSections(show).some((s) => s.id === id);
}

export function moveRow(show: Show, rowId: string, toSectionId: string | null, toIndex: number): Show {
  const row = show.rows.find((r) => r.id === rowId);
  if (!row) return show;
  if (toSectionId !== null && !hasSection(show, toSectionId)) return show;
  const groups = groupRowsBySection(show).map((g) => ({ ...g, rows: g.rows.filter((r) => r.id !== rowId) }));
  return place(show, row, toSectionId, toIndex, groups);
}

export function insertRow(show: Show, row: RundownRow, toSectionId: string | null, toIndex: number): Show {
  if (show.rows.some((r) => r.id === row.id)) return show;
  if (toSectionId !== null && !hasSection(show, toSectionId)) return show;
  const groups = groupRowsBySection(show).map((g) => ({ ...g, rows: [...g.rows] }));
  return place(show, row, toSectionId, toIndex, groups);
}

function randomHex8(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string; getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID().replace(/-/g, "").slice(0, 8);
  if (c && typeof c.getRandomValues === "function") {
    const b = c.getRandomValues(new Uint8Array(4));
    return Array.from(b, (x: number) => x.toString(16).padStart(2, "0")).join("");
  }
  return Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

export function addSection(
  show: Show,
  name: string,
  afterSectionId?: string | null,
  id?: string,
): { show: Show; section: ShowSection } {
  const trimmed = name.trim();
  if (id !== undefined) {
    const dup = uniqueSections(show).find((x) => x.id === id);
    if (dup) return { show, section: dup };
  }
  const section: ShowSection = {
    id: id ?? `sec-${randomHex8()}`,
    name: trimmed || `Section ${uniqueSections(show).length + 1}`,
  };
  const groups = groupRowsBySection(show);
  const namedIds = groups.map((g) => g.section?.id);
  let at = -1;
  if (afterSectionId === null) at = groups.findIndex((g) => g.section !== null);
  else if (afterSectionId !== undefined && namedIds.includes(afterSectionId)) at = namedIds.indexOf(afterSectionId) + 1;
  const newGroup: SectionGroup = { section, rows: [] };
  if (at < 0) groups.push(newGroup);
  else groups.splice(at, 0, newGroup);
  return { show: rebuild(show, groups), section };
}

export function renameSection(show: Show, id: string, name: string): Show {
  const trimmed = name.trim();
  if (!trimmed) return show;
  const idx = (show.sections ?? []).findIndex((s) => s.id === id);
  if (idx < 0) return show;
  if (show.sections![idx]!.name === trimmed) return show;
  const sections = show.sections!.map((s, i) => (i === idx ? { ...s, name: trimmed } : s));
  return { ...show, sections };
}

export function deleteSection(show: Show, id: string, mode: "keep-rows" | "delete-rows"): Show {
  const groups = groupRowsBySection(show);
  const at = groups.findIndex((g) => g.section?.id === id);
  if (at < 0) return show;
  const [removed] = groups.splice(at, 1);
  if (mode === "keep-rows" && removed!.rows.length > 0) {
    const prev = groups
      .slice(0, at)
      .reverse()
      .find((g) => g.section !== null);
    const dest = prev ?? ensureNoneGroup(groups);
    const destId = dest.section?.id ?? null;
    dest.rows = [...dest.rows, ...removed!.rows.map((r) => withSection(r, destId))];
  }
  return rebuild(show, groups);
}

export function moveSection(show: Show, id: string, toIndex: number): Show {
  const groups = groupRowsBySection(show);
  const none = groups.find((g) => g.section === null);
  const named = groups.filter((g) => g.section !== null);
  const from = named.findIndex((g) => g.section!.id === id);
  if (from < 0) return show;
  const [moved] = named.splice(from, 1);
  named.splice(clamp(toIndex, named.length), 0, moved!);
  return rebuild(show, none ? [none, ...named] : named);
}

/** Sum of `lengthSec` across rows; null when no row has one. */
export function sectionLength(rows: RundownRow[]): number | null {
  let total = 0;
  let any = false;
  for (const r of rows) {
    if (typeof r.lengthSec === "number") {
      total += r.lengthSec;
      any = true;
    }
  }
  return any ? total : null;
}
