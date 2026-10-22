import { z } from "zod";

/** Server-memory confidence-monitor state shared by every stage channel. */
export const StageStateSchema = z.object({
  notes: z.object({ showId: z.string(), notesId: z.string() }).nullable(),
  pointIdx: z.number().int().nonnegative(),
  /** Extra scroll inside the active point, in fractions of the notes widget's height. */
  scrollOffset: z.number(),
  message: z.object({ text: z.string(), sentAt: z.number() }).nullable(),
});
export type StageState = z.infer<typeof StageStateSchema>;

export const INITIAL_STAGE_STATE: StageState = { notes: null, pointIdx: 0, scrollOffset: 0, message: null };

export type StageAction =
  | { type: "select"; showId: string; notesId: string | null }
  | { type: "point"; delta: number }
  | { type: "point"; index: number }
  | { type: "scroll"; delta: number }
  | { type: "reset" }
  | { type: "overflow"; direction: "next" | "prev"; atPoint: number }
  | { type: "message"; text: string; now: number }
  | { type: "messageClear" };

/** Scroll is bounded to this many viewport fractions either way; overflow handles moving between points. */
export const MAX_SCROLL_OFFSET = 3;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function goTo(s: StageState, idx: number, count: number): StageState {
  const next = clamp(idx, 0, count - 1);
  return next === s.pointIdx ? s : { ...s, pointIdx: next, scrollOffset: 0 };
}

/** Pure. `pointCount` is the active notes' current point count (0 when none). */
export function reduceStageState(s: StageState, a: StageAction, pointCount: number): StageState {
  switch (a.type) {
    case "select":
      if (a.notesId === null) return s.notes ? { ...s, notes: null, pointIdx: 0, scrollOffset: 0 } : s;
      if (s.notes?.showId === a.showId && s.notes.notesId === a.notesId) return s;
      return { ...s, notes: { showId: a.showId, notesId: a.notesId }, pointIdx: 0, scrollOffset: 0 };
    case "message": {
      const text = a.text.trim();
      return { ...s, message: text ? { text, sentAt: a.now } : null };
    }
    case "messageClear":
      return s.message ? { ...s, message: null } : s;
  }
  // Malformed numeric input is ignored outright; the reducer owns its invariants.
  const valid =
    a.type === "point" ? Number.isFinite("index" in a ? a.index : a.delta)
    : a.type === "scroll" ? Number.isFinite(a.delta)
    : a.type === "overflow" ? Number.isFinite(a.atPoint)
    : true;
  if (!valid) return s;
  if (!s.notes || pointCount <= 0) return s;
  // The notes may have shrunk since the position was set; pull it back into range first.
  let cur = s;
  if (cur.pointIdx > pointCount - 1) cur = { ...cur, pointIdx: pointCount - 1, scrollOffset: 0 };
  switch (a.type) {
    case "point":
      return "index" in a
        ? goTo(cur, Math.trunc(a.index), pointCount)
        : goTo(cur, cur.pointIdx + Math.trunc(a.delta), pointCount);
    case "scroll": {
      const raw = cur.scrollOffset + a.delta;
      const lo = cur.pointIdx === 0 ? 0 : -MAX_SCROLL_OFFSET;
      return { ...cur, scrollOffset: clamp(raw, lo, MAX_SCROLL_OFFSET) };
    }
    case "reset":
      return { ...cur, pointIdx: 0, scrollOffset: 0 };
    case "overflow":
      if (a.atPoint !== cur.pointIdx) return cur;
      return goTo(cur, cur.pointIdx + (a.direction === "next" ? 1 : -1), pointCount);
  }
}
