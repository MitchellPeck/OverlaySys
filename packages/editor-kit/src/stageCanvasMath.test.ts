import { describe, expect, it } from "vitest";
import {
  DRAG_START_SCREEN_PX,
  dragMove,
  dragResize,
  marqueeSelection,
  nudgeForKey,
  nextMarqueeKey,
  normalizeMarquee,
  pastDragThreshold,
  rectsIntersect,
  sameRects,
  widgetsInMarquee,
} from "./stageCanvasMath";

const canvas = { w: 1920, h: 1080 };

describe("stageCanvasMath", () => {
  it("drag threshold is 2 screen px", () => {
    expect(DRAG_START_SCREEN_PX).toBe(2);
    expect(pastDragThreshold(2, 0)).toBe(false);
    expect(pastDragThreshold(2.1, 0)).toBe(true);
    expect(pastDragThreshold(0, -3)).toBe(true);
  });

  it("normalizes a marquee dragged in any direction", () => {
    expect(normalizeMarquee({ x: 300, y: 200 }, { x: 100, y: 50 })).toEqual({ x: 100, y: 50, w: 200, h: 150 });
  });

  it("intersects rects; touching edges do not count", () => {
    const a = { x: 0, y: 0, w: 100, h: 100 };
    expect(rectsIntersect(a, { x: 50, y: 50, w: 100, h: 100 })).toBe(true);
    expect(rectsIntersect(a, { x: 100, y: 0, w: 10, h: 10 })).toBe(false);
  });

  it("marquee selects every visible widget it intersects", () => {
    const widgets = [
      { id: "a", rect: { x: 0, y: 0, w: 100, h: 100 } },
      { id: "b", rect: { x: 500, y: 500, w: 100, h: 100 } },
      { id: "c", rect: { x: 90, y: 90, w: 50, h: 50 }, hidden: true },
      { id: "d", rect: { x: 80, y: 0, w: 50, h: 50 }, locked: true },
    ];
    expect(widgetsInMarquee(widgets, { x: 50, y: 10, w: 100, h: 100 })).toEqual(["a", "d"]);
  });

  it("the first marquee frame always reports, even with no hits; later frames only on change", () => {
    expect(nextMarqueeKey(null, [])).toBe("");
    expect(nextMarqueeKey("", [])).toBeNull();
    expect(nextMarqueeKey("", ["a"])).toBe("a");
    expect(nextMarqueeKey("a", ["a"])).toBeNull();
    expect(nextMarqueeKey("a", [])).toBe("");
  });

  it("a Shift marquee adds its hits to the selection it started with", () => {
    expect(marqueeSelection([], ["a", "b"])).toEqual(["a", "b"]);
    expect(marqueeSelection(["c", "a"], ["a", "b"])).toEqual(["c", "a", "b"]);
    expect(marqueeSelection(["c"], [])).toEqual(["c"]);
  });

  it("sameRects compares rect maps by value", () => {
    const a = { x: 1, y: 2, w: 3, h: 4 };
    expect(sameRects({ a }, { a: { ...a } })).toBe(true);
    expect(sameRects({ a }, { a: { ...a, x: 2 } })).toBe(false);
    expect(sameRects({ a }, { a, b: a })).toBe(false);
    expect(sameRects({ a }, { b: a })).toBe(false);
  });

  it("move applies the delta to every start rect without snapping", () => {
    const start = { a: { x: 100, y: 100, w: 200, h: 100 }, b: { x: 400, y: 400, w: 50, h: 50 } };
    const out = dragMove(start, "a", 13, 7, [], canvas, 0);
    expect(out.rects).toEqual({ a: { x: 113, y: 107, w: 200, h: 100 }, b: { x: 413, y: 407, w: 50, h: 50 } });
    expect(out.guides).toEqual([]);
  });

  it("move snaps the primary and shifts the rest of the selection by the same delta", () => {
    const start = { a: { x: 100, y: 100, w: 200, h: 100 }, b: { x: 400, y: 400, w: 50, h: 50 } };
    const other = { x: 0, y: 600, w: 297, h: 50 }; // right edge at 297
    // a's left edge lands at 296 and snaps to 297 (+1); y = 103 has no target within 6.
    const out = dragMove(start, "a", 196, 3, [other], canvas, 6);
    expect(out.rects.a).toEqual({ x: 297, y: 103, w: 200, h: 100 });
    expect(out.rects.b).toEqual({ x: 597, y: 403, w: 50, h: 50 });
    expect(out.guides).toEqual([{ axis: "x", at: 297 }]);
  });

  it("resize snaps only the dragged edges", () => {
    const r = { x: 100, y: 100, w: 200, h: 100 };
    // e handle: right edge 300 + 57 = 357; other's left at 360 snaps it.
    // The left edge (100) and top (100) sit near targets (103) but must not move.
    const other = { x: 360, y: 103, w: 50, h: 50 };
    const out = dragResize(r, "e", 57, 0, [other], canvas, 6);
    expect(out.rect).toEqual({ x: 100, y: 100, w: 260, h: 100 });
    expect(out.guides).toEqual([{ axis: "x", at: 360 }]);
  });

  it("resize from a start edge (w / n) snaps that edge and keeps the opposite edge fixed", () => {
    const r = { x: 100, y: 100, w: 200, h: 100 };
    const other = { x: 0, y: 0, w: 40, h: 40 }; // right edge 40, bottom 40
    // w handle: left edge 100 - 57 = 43 snaps to 40; right edge stays at 300.
    const w = dragResize(r, "w", -57, 0, [other], canvas, 6);
    expect(w.rect).toEqual({ x: 40, y: 100, w: 260, h: 100 });
    expect(w.guides).toEqual([{ axis: "x", at: 40 }]);
    // n handle: top edge 100 - 63 = 37 snaps to 40; bottom stays at 200.
    const n = dragResize(r, "n", 0, -63, [other], canvas, 6);
    expect(n.rect).toEqual({ x: 100, y: 40, w: 200, h: 160 });
    expect(n.guides).toEqual([{ axis: "y", at: 40 }]);
    // nw snaps both start edges.
    const nw = dragResize(r, "nw", -57, -63, [other], canvas, 6);
    expect(nw.rect).toEqual({ x: 40, y: 40, w: 260, h: 160 });
  });

  it("resize never shrinks below the minimum and snap is skipped at threshold 0", () => {
    const r = { x: 100, y: 100, w: 200, h: 100 };
    const out = dragResize(r, "nw", 999, 999, [], canvas, 0);
    expect(out.rect).toEqual({ x: 280, y: 180, w: 20, h: 20 });
    expect(out.guides).toEqual([]);
  });

  it("maps arrow keys to nudges, 10 px with shift", () => {
    expect(nudgeForKey("ArrowLeft", false)).toEqual([-1, 0]);
    expect(nudgeForKey("ArrowRight", true)).toEqual([10, 0]);
    expect(nudgeForKey("ArrowUp", false)).toEqual([0, -1]);
    expect(nudgeForKey("ArrowDown", true)).toEqual([0, 10]);
    expect(nudgeForKey("a", false)).toBeNull();
  });
});
