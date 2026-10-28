/** Pure stage-layout geometry: move, resize, snap, align, distribute. All values are canvas px. */

import type { StageRect } from "@overlaysys/core";

export const MIN_WIDGET_SIZE = 20;
export const SNAP_SCREEN_PX = 6;

export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export type Guide = { axis: "x" | "y"; at: number };
export type SnapEdge = "start" | "center" | "end";

export function moveRect(r: StageRect, dx: number, dy: number): StageRect {
  return { ...r, x: r.x + dx, y: r.y + dy };
}

/** Resize one axis: `start`/`size` in, the dragged side moved by `d`; the opposite side stays fixed. */
function resizeAxis(start: number, size: number, d: number, dragStart: boolean, dragEnd: boolean, min: number): [number, number] {
  if (dragEnd) return [start, Math.max(min, size + d)];
  if (dragStart) {
    const end = start + size;
    const s = Math.min(start + d, end - min);
    return [s, end - s];
  }
  return [start, size];
}

/** `min` is the smallest size an edge drag may leave (default MIN_WIDGET_SIZE). */
export function resizeRect(r: StageRect, handle: ResizeHandle, dx: number, dy: number, min = MIN_WIDGET_SIZE): StageRect {
  const [x, w] = resizeAxis(r.x, r.w, dx, handle.includes("w"), handle.includes("e"), min);
  const [y, h] = resizeAxis(r.y, r.h, dy, handle.includes("n"), handle.includes("s"), min);
  return { x, y, w, h };
}

export function boundsOf(rects: StageRect[]): StageRect {
  if (rects.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  const x1 = Math.min(...rects.map((r) => r.x));
  const y1 = Math.min(...rects.map((r) => r.y));
  const x2 = Math.max(...rects.map((r) => r.x + r.w));
  const y2 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

const ALL_EDGES: SnapEdge[] = ["start", "center", "end"];

function edgeOffset(size: number, edge: SnapEdge): number {
  return edge === "start" ? 0 : edge === "center" ? size / 2 : size;
}

/** Best snap on one axis: returns the shift to apply and the guide position, or null. */
function snapAxis(
  start: number,
  size: number,
  targets: number[],
  threshold: number,
  edges: SnapEdge[],
): { delta: number; at: number } | null {
  let best: { delta: number; at: number } | null = null;
  for (const edge of edges) {
    const pos = start + edgeOffset(size, edge);
    for (const t of targets) {
      const delta = t - pos;
      if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) {
        best = { delta, at: t };
      }
    }
  }
  return best;
}

export function snapRect(
  moving: StageRect,
  others: StageRect[],
  canvas: { w: number; h: number },
  threshold: number,
  edges: { x: SnapEdge[]; y: SnapEdge[] } = { x: ALL_EDGES, y: ALL_EDGES },
  min = MIN_WIDGET_SIZE,
): { rect: StageRect; guides: Guide[] } {
  const xs = [0, canvas.w / 2, canvas.w];
  const ys = [0, canvas.h / 2, canvas.h];
  for (const o of others) {
    xs.push(o.x, o.x + o.w / 2, o.x + o.w);
    ys.push(o.y, o.y + o.h / 2, o.y + o.h);
  }
  const rect = { ...moving };
  const guides: Guide[] = [];

  // Moving snaps shift the rect; a resize (only some edges listed) moves just those edges.
  const sx = snapAxis(moving.x, moving.w, xs, threshold, edges.x);
  if (sx) {
    applyAxis(rect, "x", "w", edges.x, sx.delta, min);
    guides.push({ axis: "x", at: sx.at });
  }
  const sy = snapAxis(moving.y, moving.h, ys, threshold, edges.y);
  if (sy) {
    applyAxis(rect, "y", "h", edges.y, sy.delta, min);
    guides.push({ axis: "y", at: sy.at });
  }
  return { rect, guides };
}

function applyAxis(rect: StageRect, pos: "x" | "y", size: "w" | "h", edges: SnapEdge[], delta: number, min: number): void {
  const hasStart = edges.includes("start");
  const hasEnd = edges.includes("end");
  if (hasStart && hasEnd) {
    rect[pos] += delta; // whole-rect move
  } else if (hasEnd && !hasStart) {
    rect[size] = Math.max(min, rect[size] + delta); // resizing the end edge
  } else if (hasStart && !hasEnd) {
    const end = rect[pos] + rect[size];
    const s = Math.min(rect[pos] + delta, end - min);
    rect[pos] = s;
    rect[size] = end - s;
  } else {
    rect[pos] += delta; // center-only
  }
}

export type AlignMode = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

export function alignRects(rects: StageRect[], mode: AlignMode, canvas: { w: number; h: number }): StageRect[] {
  const b = rects.length === 1 ? { x: 0, y: 0, w: canvas.w, h: canvas.h } : boundsOf(rects);
  return rects.map((r) => {
    switch (mode) {
      case "left":
        return { ...r, x: b.x };
      case "hcenter":
        return { ...r, x: b.x + (b.w - r.w) / 2 };
      case "right":
        return { ...r, x: b.x + b.w - r.w };
      case "top":
        return { ...r, y: b.y };
      case "vcenter":
        return { ...r, y: b.y + (b.h - r.h) / 2 };
      case "bottom":
        return { ...r, y: b.y + b.h - r.h };
    }
  });
}

export function distributeRects(rects: StageRect[], axis: "x" | "y"): StageRect[] {
  if (rects.length < 3) return rects.map((r) => ({ ...r }));
  const pos = axis;
  const size = axis === "x" ? "w" : "h";
  const order = rects.map((_, i) => i).sort((a, b) => rects[a]![pos] - rects[b]![pos]);
  const first = rects[order[0]!]!;
  const last = rects[order[order.length - 1]!]!;
  const span = last[pos] + last[size] - first[pos];
  const total = order.reduce((s, i) => s + rects[i]![size], 0);
  const gap = (span - total) / (order.length - 1);
  const out = rects.map((r) => ({ ...r }));
  let cursor = first[pos];
  for (const i of order) {
    out[i]![pos] = cursor;
    cursor += rects[i]![size] + gap;
  }
  return out;
}
