import { groupRowsBySection, type Show } from "@overlaysys/core";
import type { AirState } from "../../../lib/rowAirState";
import type { RowLike } from "../../../lib/rowLike";
import { nextRowId } from "../../../lib/liveNext";
import { formatRowLength, showTotal } from "../../../lib/rowLength";
import { nudgeRow } from "../../shows/edit/showEditOps";

/**
 * liveNext's next row, but never one that can't be taken (unsupported, a
 * slides row whose deck is gone, a scripture with no slides…): from there it
 * skips forward to the next takeable row that isn't already on program.
 */
export function takeableNextRowId(
  rows: RowLike[],
  air: Record<string, AirState>,
  selectedRowId: string | null,
  canTake: (rowId: string) => boolean,
): string | null {
  const n = nextRowId(rows, air, selectedRowId);
  if (n === null) return null;
  const from = rows.findIndex((r) => r.id === n);
  for (let i = from; i >= 0 && i < rows.length; i++) {
    const r = rows[i]!;
    if (air[r.id] !== "program" && canTake(r.id)) return r.id;
  }
  return null;
}

export type LiveRowState = {
  chip: "onair" | "cued" | null;
  otherShow: boolean;
  /** Green "next" treatment. */
  next: boolean;
  showTake: boolean;
  showCue: boolean;
  tooltip: string | null;
};

export function liveRowState(p: {
  air: AirState;
  isNext: boolean;
  selected: boolean;
  canCue: boolean;
}): LiveRowState {
  const next = p.isNext && p.air !== "program";
  return {
    chip: p.air === "program" ? "onair" : p.air === "preview" ? "cued" : null,
    otherShow: p.air === "other-show",
    next,
    showTake: next,
    showCue: p.selected && p.canCue && p.air !== "program" && p.air !== "preview",
    tooltip: p.air === "other-show" ? "On air in another show" : null,
  };
}

/** Inset bar and background for a live row. On air wins over next; selection paints the control background. */
export function liveRowSurface(p: { air: AirState; next: boolean; selected: boolean }): {
  boxShadow: string;
  background: string;
} {
  if (p.air === "program") {
    return { boxShadow: "inset 3px 0 0 var(--onair)", background: "rgba(229,72,77,0.10)" };
  }
  return {
    boxShadow: p.next ? "inset 3px 0 0 var(--ok)" : "none",
    background: p.selected ? "var(--control)" : "transparent",
  };
}

/** Which half of a row the pointer is over (offset from the row's top). */
export function dropHalf(offsetY: number, height: number): "before" | "after" {
  return offsetY < height / 2 ? "before" : "after";
}

/** "Sunday · 9 items · Total 42:10" (the total only when some row has a length). */
export function headerLine(show: Show): string {
  const n = show.rows.length;
  const parts = [show.name, `${n} ${n === 1 ? "item" : "items"}`];
  const total = showTotal(show.rows);
  if (total !== null) parts.push(`Total ${formatRowLength(total)}`);
  return parts.join(" · ");
}

/** Alt+↑/↓ as an onMoveRow target; null when the row can't move that way. */
export function nudgeTarget(
  show: Show,
  rowId: string,
  delta: -1 | 1,
): { toSectionId: string | null; toIndex: number } | null {
  const moved = nudgeRow(show, rowId, delta);
  if (moved === show) return null;
  for (const g of groupRowsBySection(moved)) {
    const i = g.rows.findIndex((r) => r.id === rowId);
    if (i >= 0) return { toSectionId: g.section?.id ?? null, toIndex: i };
  }
  return null;
}
