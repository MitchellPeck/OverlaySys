"use client";

import { useMemo } from "react";
import { create } from "zustand";
import type { OverflowWarning } from "@/lib/textOverflow";

/**
 * Text-overflow warnings measured from the selected graphic's thumbnail, by
 * row id. Session-only UI state: the edit panel shows the per-field badges and
 * the rundown marks the row with a warning icon.
 */
type OverflowState = {
  byRow: Record<string, OverflowWarning[]>;
  setRowWarnings(rowId: string, w: OverflowWarning[]): void;
};

const same = (a: OverflowWarning[] | undefined, b: OverflowWarning[]) =>
  (a?.length ?? 0) === b.length && b.every((w, i) => a?.[i]?.key === w.key && a[i]!.shown === w.shown && a[i]!.total === w.total);

export const useOverflowStore = create<OverflowState>((set) => ({
  byRow: {},
  setRowWarnings: (rowId, w) =>
    set((s) => {
      if (same(s.byRow[rowId], w)) return s;
      const byRow = { ...s.byRow };
      if (w.length === 0) delete byRow[rowId];
      else byRow[rowId] = w;
      return { byRow };
    }),
}));

/** Rows with at least one field that doesn't fit. */
export function useWarnRowIds(): Set<string> {
  const byRow = useOverflowStore((s) => s.byRow);
  return useMemo(() => new Set(Object.keys(byRow)), [byRow]);
}

const NONE: OverflowWarning[] = [];

export function useRowWarnings(rowId: string): OverflowWarning[] {
  return useOverflowStore((s) => s.byRow[rowId] ?? NONE);
}
