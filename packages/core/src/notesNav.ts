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
  if (!s.notes || pointCount <= 0) return s;
  switch (a.type) {
    case "point":
      return "index" in a ? goTo(s, a.index, pointCount) : goTo(s, s.pointIdx + a.delta, pointCount);
    case "scroll": {
      const raw = s.scrollOffset + a.delta;
      return { ...s, scrollOffset: s.pointIdx === 0 ? Math.max(0, raw) : raw };
    }
    case "reset":
      return { ...s, pointIdx: 0, scrollOffset: 0 };
    case "overflow":
      if (a.atPoint !== s.pointIdx) return s;
      return goTo(s, s.pointIdx + (a.direction === "next" ? 1 : -1), pointCount);
  }
}
