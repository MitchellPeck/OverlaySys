import { describe, expect, it } from "vitest";
import { INITIAL_STAGE_STATE, MAX_SCROLL_OFFSET, reduceStageState, type StageState } from "./notesNav";

const active = (over: Partial<StageState> = {}): StageState => ({
  ...INITIAL_STAGE_STATE,
  notes: { showId: "s", notesId: "n" },
  ...over,
});

describe("reduceStageState", () => {
  it("select sets notes and resets position; selecting the same set is a no-op", () => {
    const a = reduceStageState(active({ pointIdx: 3, scrollOffset: 0.5 }), { type: "select", showId: "s", notesId: "n2" }, 5);
    expect(a).toMatchObject({ notes: { showId: "s", notesId: "n2" }, pointIdx: 0, scrollOffset: 0 });
    const same = active({ pointIdx: 3 });
    expect(reduceStageState(same, { type: "select", showId: "s", notesId: "n" }, 5)).toBe(same);
  });

  it("select null clears notes", () => {
    expect(reduceStageState(active(), { type: "select", showId: "s", notesId: null }, 5).notes).toBeNull();
  });

  it("point delta clamps without wrapping and resets scroll", () => {
    expect(reduceStageState(active({ pointIdx: 4, scrollOffset: 0.3 }), { type: "point", delta: 1 }, 5)).toMatchObject({ pointIdx: 4, scrollOffset: 0.3 });
    expect(reduceStageState(active({ pointIdx: 0 }), { type: "point", delta: -1 }, 5).pointIdx).toBe(0);
    expect(reduceStageState(active({ pointIdx: 1, scrollOffset: 0.3 }), { type: "point", delta: 1 }, 5)).toMatchObject({ pointIdx: 2, scrollOffset: 0 });
  });

  it("point index clamps into range", () => {
    expect(reduceStageState(active(), { type: "point", index: 99 }, 5).pointIdx).toBe(4);
    expect(reduceStageState(active({ pointIdx: 2 }), { type: "point", index: -3 }, 5).pointIdx).toBe(0);
  });

  it("navigation without active notes or with zero points is a no-op", () => {
    const s = { ...INITIAL_STAGE_STATE };
    expect(reduceStageState(s, { type: "point", delta: 1 }, 5)).toBe(s);
    const a = active();
    expect(reduceStageState(a, { type: "point", delta: 1 }, 0)).toBe(a);
  });

  it("scroll accumulates and floors at zero on the first point", () => {
    const one = reduceStageState(active(), { type: "scroll", delta: 0.33 }, 5);
    expect(one.scrollOffset).toBeCloseTo(0.33);
    expect(reduceStageState(one, { type: "scroll", delta: -1 }, 5).scrollOffset).toBe(0);
  });

  it("scroll may go negative on later points (overflow handles moving back)", () => {
    expect(reduceStageState(active({ pointIdx: 2 }), { type: "scroll", delta: -0.33 }, 5).scrollOffset).toBeCloseTo(-0.33);
  });

  it("reset returns to point 0 / scroll 0", () => {
    expect(reduceStageState(active({ pointIdx: 3, scrollOffset: 1 }), { type: "reset" }, 5)).toMatchObject({ pointIdx: 0, scrollOffset: 0 });
  });

  it("overflow moves one point only when the observed point is still current", () => {
    const s = active({ pointIdx: 2, scrollOffset: 0.9 });
    const moved = reduceStageState(s, { type: "overflow", direction: "next", atPoint: 2 }, 5);
    expect(moved).toMatchObject({ pointIdx: 3, scrollOffset: 0 });
    // A second window reporting the same overflow is ignored.
    expect(reduceStageState(moved, { type: "overflow", direction: "next", atPoint: 2 }, 5)).toBe(moved);
    expect(reduceStageState(active({ pointIdx: 2 }), { type: "overflow", direction: "prev", atPoint: 2 }, 5).pointIdx).toBe(1);
  });

  it("overflow at the ends clamps (no change)", () => {
    const last = active({ pointIdx: 4, scrollOffset: 2 });
    expect(reduceStageState(last, { type: "overflow", direction: "next", atPoint: 4 }, 5)).toBe(last);
  });

  it("messages set and clear", () => {
    const m = reduceStageState(INITIAL_STAGE_STATE, { type: "message", text: " Wrap up ", now: 7 }, 0);
    expect(m.message).toEqual({ text: "Wrap up", sentAt: 7 });
    expect(reduceStageState(m, { type: "messageClear" }, 0).message).toBeNull();
    expect(reduceStageState(INITIAL_STAGE_STATE, { type: "message", text: "   ", now: 7 }, 0).message).toBeNull();
  });
});

describe("reduceStageState invariants", () => {
  it("ignores non-finite point, scroll and overflow inputs", () => {
    const s = active({ pointIdx: 2, scrollOffset: 0.5 });
    expect(reduceStageState(s, { type: "point", delta: Number.NaN }, 5)).toBe(s);
    expect(reduceStageState(s, { type: "point", index: Number.POSITIVE_INFINITY }, 5)).toBe(s);
    expect(reduceStageState(s, { type: "scroll", delta: Number.POSITIVE_INFINITY }, 5)).toBe(s);
    expect(reduceStageState(s, { type: "scroll", delta: Number.NEGATIVE_INFINITY }, 5)).toBe(s);
    expect(reduceStageState(s, { type: "overflow", direction: "next", atPoint: Number.NaN }, 5)).toBe(s);
  });

  it("truncates point delta and index toward zero", () => {
    expect(reduceStageState(active(), { type: "point", index: 1.7 }, 5).pointIdx).toBe(1);
    expect(reduceStageState(active(), { type: "point", delta: 1.7 }, 5).pointIdx).toBe(1);
  });

  it("bounds scroll offset to +/- MAX_SCROLL_OFFSET", () => {
    expect(MAX_SCROLL_OFFSET).toBe(3);
    let s = active({ pointIdx: 4 });
    for (let i = 0; i < 5; i++) s = reduceStageState(s, { type: "scroll", delta: 1 }, 5);
    expect(s.scrollOffset).toBe(MAX_SCROLL_OFFSET);
    expect(reduceStageState(s, { type: "scroll", delta: -0.33 }, 5).scrollOffset).toBeCloseTo(2.67);
    expect(reduceStageState(active({ pointIdx: 2, scrollOffset: -2.9 }), { type: "scroll", delta: -1 }, 5).scrollOffset).toBe(-MAX_SCROLL_OFFSET);
  });

  it("clamps the position when the active notes shrank", () => {
    const shrunk = active({ pointIdx: 4, scrollOffset: 0.5 });
    const overflow = reduceStageState(shrunk, { type: "overflow", direction: "next", atPoint: 4 }, 3);
    expect(overflow).toMatchObject({ pointIdx: 2, scrollOffset: 0 });
    expect(reduceStageState(shrunk, { type: "scroll", delta: 0.1 }, 3).pointIdx).toBe(2);
  });
});
