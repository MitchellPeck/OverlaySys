import { addSection, groupRowsBySection, insertRow, moveRow, type Show } from "@overlaysys/core";
import { formatRowLength, showTotal } from "../../../lib/rowLength";
import { insertRowsAfter, nameForSave, restoreRow, type RowLike } from "./showEditOps";

/**
 * The selected row's section: its id when the section exists, null when the
 * row is in the no-section group, undefined when nothing is selected.
 */
export function sectionIdOf(show: Show, rowId: string | null): string | null | undefined {
  if (!rowId) return undefined;
  for (const g of groupRowsBySection(show)) {
    if (g.rows.some((r) => r.id === rowId)) return g.section?.id ?? null;
  }
  return undefined;
}

/** New items go after the selection, in its section; with no selection, at the end of the last group. */
export function insertNewRows(show: Show, selectedRowId: string | null, rows: RowLike[]): Show {
  if (selectedRowId && show.rows.some((r) => r.id === selectedRowId)) {
    return insertRowsAfter(show, selectedRowId, null, rows);
  }
  const last = groupRowsBySection(show).at(-1);
  const anchor = last?.rows.at(-1)?.id ?? null;
  return insertRowsAfter(show, anchor, last?.section?.id ?? null, rows);
}

/** A copy of the row (every key kept) under `newId`, right after the original. */
export function duplicateRowIn(show: Show, rowId: string, newId: string): Show {
  const row = show.rows.find((r) => r.id === rowId);
  if (!row) return show;
  return insertRowsAfter(show, rowId, null, [{ ...row, id: newId } as RowLike]);
}

/** Targets for the row menu's "Move to section": every other section, and "No section" when the row has one. */
export function moveToSectionChoices(show: Show, rowId: string): { id: string | null; label: string }[] {
  const current = sectionIdOf(show, rowId);
  const out: { id: string | null; label: string }[] = [];
  if (current) out.push({ id: null, label: "No section" });
  for (const g of groupRowsBySection(show)) {
    if (g.section && g.section.id !== current) out.push({ id: g.section.id, label: g.section.name });
  }
  return out;
}

/** Move a row to the end of a section (null = the no-section group). */
export function moveRowToSection(show: Show, rowId: string, sectionId: string | null): Show {
  const g = groupRowsBySection(show).find((x) => (x.section?.id ?? null) === sectionId);
  const len = g ? g.rows.filter((r) => r.id !== rowId).length : 0;
  return moveRow(show, rowId, sectionId, len);
}

export function sectionRowCount(show: Show, sectionId: string): number {
  return groupRowsBySection(show).find((g) => g.section?.id === sectionId)?.rows.length ?? 0;
}

/** "<n> item(s) · Total M:SS"; the total only when some row has a length. */
export function itemSummary(show: Show): string {
  const n = show.rows.length;
  const parts = [`${n} ${n === 1 ? "item" : "items"}`];
  const total = showTotal(show.rows);
  if (total !== null) parts.push(`Total ${formatRowLength(total)}`);
  return parts.join(" · ");
}

/** The payload for save_show: the draft as loaded (unknown keys kept) with a usable name. */
export function showForSave(show: Show): Show {
  return { ...show, name: nameForSave(show.name) };
}

/** After an ack, the baseline moves only if the draft is still the one that was sent. */
export function savedSettles(sent: Show, current: Show | null): boolean {
  return current === sent;
}

/** Undo of a row delete: only in the same show (never into another one); later edits are kept. */
export function undoRowDelete(
  current: Show,
  showId: string,
  removed: { row: RowLike; index: number },
): Show {
  if (current.id !== showId) return current;
  return restoreRow(current, removed);
}

/**
 * Undo of a section delete. `prev` is the draft before the delete and `next`
 * the draft right after it. Nothing happens in another show. With no edits
 * since, `prev` comes back as is; otherwise the section is re-added at its old
 * place and its rows return to it (rows the delete removed are re-inserted,
 * rows deleted separately later stay deleted), keeping every later edit.
 */
export function undoSectionDelete(current: Show, prev: Show, next: Show, sectionId: string): Show {
  if (current.id !== prev.id) return current;
  if (current === next) return prev;
  const prevGroups = groupRowsBySection(prev);
  const gi = prevGroups.findIndex((g) => g.section?.id === sectionId);
  if (gi < 0) return current;
  const section = prevGroups[gi]!.section!;
  let out = current;
  if (!(out.sections ?? []).some((s) => s.id === sectionId)) {
    const curIds = new Set((out.sections ?? []).map((s) => s.id));
    const before = prevGroups
      .slice(0, gi)
      .map((g) => g.section?.id)
      .filter((id): id is string => !!id && curIds.has(id))
      .at(-1);
    out = addSection(out, section.name, before ?? null, sectionId).show;
    // Keep any extra keys the section carried.
    out = { ...out, sections: (out.sections ?? []).map((s) => (s.id === sectionId ? section : s)) };
  }
  const inNext = new Set(next.rows.map((r) => r.id));
  let at = 0;
  for (const row of prevGroups[gi]!.rows) {
    if (out.rows.some((r) => r.id === row.id)) out = moveRow(out, row.id, sectionId, at);
    else if (!inNext.has(row.id)) out = insertRow(out, row, sectionId, at);
    else continue;
    at++;
  }
  return out;
}

/** A show-wide song default with nothing set that no song item uses any more (left behind by changing an item's song). */
export function isBareUnusedSongDefault(show: Show, songId: string): boolean {
  const entry = show.songs.find((e) => e.songId === songId);
  if (!entry || Object.keys(entry).some((k) => k !== "songId")) return false;
  return !show.rows.some((r) => r.kind === "song" && r.songId === songId);
}
