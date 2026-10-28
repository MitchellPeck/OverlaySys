import type { Show, ShowSection } from "@overlaysys/core";
import { groupRowsBySection } from "@overlaysys/core";
import type { AirState } from "./rowAirState";
import type { RowLike } from "./rowLike";
import { showTotal } from "./rowLength";

export type LiveGroup = {
  section: ShowSection | null;
  rows: RowLike[];
  lengthSec: number | null;
  /** Index in the flat rundown of this group's first row. */
  startIndex: number;
};

/** Rows grouped by section (unknown section ids fall in the no-section group), with totals and running row index. */
export function liveGroups(show: Show): LiveGroup[] {
  let start = 0;
  return groupRowsBySection(show).map((g) => {
    const group: LiveGroup = { section: g.section, rows: g.rows, lengthSec: showTotal(g.rows), startIndex: start };
    start += g.rows.length;
    return group;
  });
}

const SUPPORTED = new Set(["graphic", "song", "scripture", "video", "slides"]);

/**
 * The row the operator is most likely to take next: the one cued on preview,
 * else the selection when it isn't already on program, else the next
 * supported row after the one on program.
 */
export function nextRowId(
  rows: RowLike[],
  air: Record<string, AirState>,
  selectedRowId: string | null,
): string | null {
  const cued = rows.find((r) => air[r.id] === "preview");
  if (cued) return cued.id;
  const selected = selectedRowId ? rows.find((r) => r.id === selectedRowId) : undefined;
  if (selected && air[selected.id] !== "program") return selected.id;
  const from = selected ?? rows.find((r) => air[r.id] === "program");
  if (!from) return null;
  const idx = rows.indexOf(from);
  for (let i = idx + 1; i < rows.length; i++) {
    const r = rows[i]!;
    if (SUPPORTED.has(r.kind)) return r.id;
  }
  return null;
}
