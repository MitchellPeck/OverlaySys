import { describe, expect, it } from "vitest";
import { alignRects, boundsOf, distributeRects, moveRect, resizeRect, snapRect } from "./stageGeometry";

const r = { x: 100, y: 100, w: 200, h: 100 };
const canvas = { w: 1920, h: 1080 };

describe("stageGeometry", () => {
  it("moves", () => {
    expect(moveRect(r, 5, -5)).toEqual({ x: 105, y: 95, w: 200, h: 100 });
  });
  it("resize se grows, nw keeps the bottom-right fixed", () => {
    expect(resizeRect(r, "se", 50, 20)).toEqual({ x: 100, y: 100, w: 250, h: 120 });
    expect(resizeRect(r, "nw", 50, 20)).toEqual({ x: 150, y: 120, w: 150, h: 80 });
  });
  it("resize past the opposite edge clamps to the minimum, never <= 0", () => {
    expect(resizeRect(r, "e", -500, 0)).toEqual({ x: 100, y: 100, w: 20, h: 100 });
    expect(resizeRect(r, "w", 500, 0)).toEqual({ x: 280, y: 100, w: 20, h: 100 });
    expect(resizeRect(r, "n", 0, 999).h).toBe(20);
    expect(resizeRect(r, "n", 0, 999).y).toBe(180);
  });
  it("boundsOf", () => {
    expect(boundsOf([{ x: 0, y: 5, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 }])).toEqual({ x: 0, y: 0, w: 30, h: 15 });
  });
  it("snaps to canvas center and reports the guide", () => {
    const { rect, guides } = snapRect({ x: 858, y: 10, w: 200, h: 50 }, [], canvas, 6);
    expect(rect.x).toBe(860);
    expect(guides).toContainEqual({ axis: "x", at: 960 });
  });
  it("snaps to another widget's edge, not beyond threshold", () => {
    const other = { x: 500, y: 0, w: 100, h: 100 };
    expect(snapRect({ x: 603, y: 300, w: 50, h: 50 }, [other], canvas, 6).rect.x).toBe(600);
    expect(snapRect({ x: 620, y: 300, w: 50, h: 50 }, [other], canvas, 6).rect.x).toBe(620);
  });
  it("resize snap moves only the dragged edge", () => {
    const { rect } = snapRect({ x: 100, y: 100, w: 857, h: 50 }, [], canvas, 6, { x: ["end"], y: [] });
    expect(rect).toEqual({ x: 100, y: 100, w: 860, h: 50 });
  });
  it("align left to selection bounds; single aligns to canvas", () => {
    const a = { x: 10, y: 0, w: 50, h: 50 }, b = { x: 100, y: 0, w: 50, h: 50 };
    expect(alignRects([a, b], "left", canvas).map((x) => x.x)).toEqual([10, 10]);
    expect(alignRects([b], "hcenter", canvas)[0]!.x).toBe(935);
  });
  it("distribute x evens gaps and keeps order; <3 unchanged", () => {
    const rs = [{ x: 0, y: 0, w: 10, h: 10 }, { x: 15, y: 0, w: 10, h: 10 }, { x: 100, y: 0, w: 10, h: 10 }];
    expect(distributeRects(rs, "x").map((x) => x.x)).toEqual([0, 50, 100]);
    expect(distributeRects(rs.slice(0, 2), "x")).toEqual(rs.slice(0, 2));
  });
});
