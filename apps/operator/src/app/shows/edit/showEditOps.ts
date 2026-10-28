import { insertRow, moveRow, groupRowsBySection, type RundownRow, type Show } from "@overlaysys/core";

export type RowLike = RundownRow;

export type DropPos =
  | { overRowId: string; half: "before" | "after" }
  | { overSectionId: string | null; at: "start" | "end" };

/** Remove a row; `removed` carries what restoreRow needs (row incl. sectionId, and its index within its group). */
export function removeRowAt(
  show: Show,
  rowId: string,
): { show: Show; removed: { row: RowLike; index: number } | null } {
  const row = show.rows.find((r) => r.id === rowId);
  if (!row) return { show, removed: null };
  const group = groupRowsBySection(show).find((g) => g.rows.some((r) => r.id === rowId))!;
  const index = group.rows.findIndex((r) => r.id === rowId);
  return { show: { ...show, rows: show.rows.filter((r) => r.id !== rowId) }, removed: { row, index } };
}

/** Undo of removeRowAt. If the row's section no longer exists it lands in the no-section group. */
export function restoreRow(show: Show, removed: { row: RowLike; index: number }): Show {
  const { row, index } = removed;
  const sid = row.sectionId ?? null;
  const known = sid !== null && (show.sections ?? []).some((s) => s.id === sid);
  return insertRow(show, row, known ? sid : null, index);
}

/** Alt+Up/Down: move one place, crossing section boundaries. */
export function nudgeRow(show: Show, rowId: string, delta: -1 | 1): Show {
  const groups = groupRowsBySection(show);
  const gi = groups.findIndex((g) => g.rows.some((r) => r.id === rowId));
  if (gi < 0) return show;
  const g = groups[gi]!;
  const i = g.rows.findIndex((r) => r.id === rowId);
  const j = i + delta;
  if (j >= 0 && j < g.rows.length) return moveRow(show, rowId, g.section?.id ?? null, j);
  const next = groups[gi + delta];
  if (!next) return show;
  return moveRow(show, rowId, next.section?.id ?? null, delta < 0 ? next.rows.length : 0);
}

/**
 * Resolve a drop position to a destination section and index. The index is in
 * the destination group as currently displayed (the dragged row still in it).
 */
export function dropTarget(show: Show, pos: DropPos): { toSectionId: string | null; toIndex: number } {
  const groups = groupRowsBySection(show);
  if ("overRowId" in pos) {
    for (const g of groups) {
      const i = g.rows.findIndex((r) => r.id === pos.overRowId);
      if (i >= 0) return { toSectionId: g.section?.id ?? null, toIndex: pos.half === "before" ? i : i + 1 };
    }
    return { toSectionId: null, toIndex: show.rows.length };
  }
  const g = groups.find((x) => (x.section?.id ?? null) === pos.overSectionId);
  if (!g) return { toSectionId: pos.overSectionId, toIndex: 0 };
  return { toSectionId: pos.overSectionId, toIndex: pos.at === "start" ? 0 : g.rows.length };
}

export function canSave(s: {
  connected: boolean;
  cloud: boolean;
  dirty: boolean;
  saving: boolean;
}): { ok: boolean; reason: string | null } {
  if (s.saving) return { ok: false, reason: "Saving…" };
  if (!s.dirty) return { ok: false, reason: "No changes to save" };
  if (!s.connected && !s.cloud) return { ok: false, reason: "Not connected" };
  return { ok: true, reason: null };
}

export function nameForSave(name: string): string {
  const t = name.trim();
  return t || "Untitled show";
}

/** Insert `rows` in order after `afterRowId` (or at the start of `sectionId` when null). */
export function insertRowsAfter(
  show: Show,
  afterRowId: string | null,
  sectionId: string | null,
  rows: RowLike[],
): Show {
  let out = show;
  let anchor = afterRowId;
  for (const row of rows) {
    const groups = groupRowsBySection(out);
    let sid = sectionId;
    let at = 0;
    if (anchor !== null) {
      const g = groups.find((x) => x.rows.some((r) => r.id === anchor));
      if (g) {
        sid = g.section?.id ?? null;
        at = g.rows.findIndex((r) => r.id === anchor) + 1;
      } else {
        at = groups.find((x) => (x.section?.id ?? null) === sectionId)?.rows.length ?? 0;
      }
    }
    out = insertRow(out, row, sid, at);
    anchor = row.id;
  }
  return out;
}
