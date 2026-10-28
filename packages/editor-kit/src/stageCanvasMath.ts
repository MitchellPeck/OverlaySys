/** Pure pointer/keyboard math behind StageCanvas. All rects are canvas px. */
import type { StageRect } from "@overlaysys/core";
import { moveRect, resizeRect, snapRect, type Guide, type ResizeHandle, type SnapEdge } from "./stageGeometry";

/** A drag starts (and history is pushed) once the pointer passes this many screen px. */
export const DRAG_START_SCREEN_PX = 2;

export function pastDragThreshold(dxScreen: number, dyScreen: number): boolean {
  return Math.abs(dxScreen) > DRAG_START_SCREEN_PX || Math.abs(dyScreen) > DRAG_START_SCREEN_PX;
}

export function normalizeMarquee(a: { x: number; y: number }, b: { x: number; y: number }): StageRect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

/** Strict overlap: rects that only touch at an edge do not intersect. */
export function rectsIntersect(a: StageRect, b: StageRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Ids of the non-hidden widgets the marquee touches, in layout order. */
export function widgetsInMarquee(
  widgets: readonly { id: string; rect: StageRect; hidden?: boolean }[],
  marquee: StageRect,
): string[] {
  return widgets.filter((w) => !w.hidden && rectsIntersect(w.rect, marquee)).map((w) => w.id);
}

/**
 * Dedupe marquee selection reports. `prev` is null before the first frame, so
 * the first frame always reports (an empty hit list must still clear the
 * selection). Returns the new key when the caller should report, else null.
 */
export function nextMarqueeKey(prev: string | null, ids: readonly string[]): string | null {
  const key = ids.join("\n");
  return key === prev ? null : key;
}

/** Selection for a marquee frame: `base` (the selection a Shift-marquee started with, else []) plus new hits. */
export function marqueeSelection(base: readonly string[], hits: readonly string[]): string[] {
  const out = [...base];
  for (const id of hits) if (!out.includes(id)) out.push(id);
  return out;
}

/** Same ids with equal rects. */
export function sameRects(a: Record<string, StageRect>, b: Record<string, StageRect>): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => {
    const ra = a[k]!;
    const rb = b[k];
    return !!rb && ra.x === rb.x && ra.y === rb.y && ra.w === rb.w && ra.h === rb.h;
  });
}

/**
 * Move every start rect by (dx, dy). The primary rect snaps against `others`
 * (threshold 0 disables snapping) and the snap correction is applied to the
 * whole selection, so the group keeps its shape.
 */
export function dragMove(
  start: Record<string, StageRect>,
  primaryId: string,
  dx: number,
  dy: number,
  others: StageRect[],
  canvas: { w: number; h: number },
  threshold: number,
): { rects: Record<string, StageRect>; guides: Guide[] } {
  let ddx = dx;
  let ddy = dy;
  let guides: Guide[] = [];
  const primary = start[primaryId];
  if (primary && threshold > 0) {
    const moved = moveRect(primary, dx, dy);
    const snapped = snapRect(moved, others, canvas, threshold);
    ddx += snapped.rect.x - moved.x;
    ddy += snapped.rect.y - moved.y;
    guides = snapped.guides;
  }
  const rects: Record<string, StageRect> = {};
  for (const [id, r] of Object.entries(start)) rects[id] = moveRect(r, ddx, ddy);
  return { rects, guides };
}

function draggedEdges(handle: ResizeHandle): { x: SnapEdge[]; y: SnapEdge[] } {
  return {
    x: handle.includes("w") ? ["start"] : handle.includes("e") ? ["end"] : [],
    y: handle.includes("n") ? ["start"] : handle.includes("s") ? ["end"] : [],
  };
}

/** Resize through `resizeRect`, then snap only the edges the handle drags. */
export function dragResize(
  start: StageRect,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  others: StageRect[],
  canvas: { w: number; h: number },
  threshold: number,
  min?: number,
): { rect: StageRect; guides: Guide[] } {
  const resized = resizeRect(start, handle, dx, dy, min);
  if (threshold <= 0) return { rect: resized, guides: [] };
  return snapRect(resized, others, canvas, threshold, draggedEdges(handle), min);
}

/** Arrow key → nudge delta in canvas px (1, or 10 with Shift); null for other keys. */
export function nudgeForKey(key: string, shift: boolean): [number, number] | null {
  const step = shift ? 10 : 1;
  switch (key) {
    case "ArrowLeft":
      return [-step, 0];
    case "ArrowRight":
      return [step, 0];
    case "ArrowUp":
      return [0, -step];
    case "ArrowDown":
      return [0, step];
    default:
      return null;
  }
}
