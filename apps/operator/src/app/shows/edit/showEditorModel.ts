import { groupRowsBySection, moveRow, type Show } from "@overlaysys/core";
import { formatRowLength, showTotal } from "../../../lib/rowLength";
import { insertRowsAfter, nameForSave, type RowLike } from "./showEditOps";

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
