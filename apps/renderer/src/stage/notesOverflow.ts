/**
 * Whether free-scrolling has moved past the active point. The active point's
 * top sits at `anchor * boxHeight` before scrolling; scrollOffset shifts it up
 * by `scrollOffset * boxHeight`. Moving on once the point's bottom passes the
 * anchor line (down), or once its top drops a full anchor gap below the anchor
 * line (up), lets a pastor who only uses scroll buttons walk through points.
 */
export function overflowDirection(o: {
  scrollOffset: number;
  boxHeight: number;
  anchor: number;
  pointTop: number;
  pointHeight: number;
  isFirst: boolean;
  isLast: boolean;
}): "next" | "prev" | null {
  const anchorY = o.anchor * o.boxHeight;
  const shift = o.scrollOffset * o.boxHeight;
  const bottom = anchorY + o.pointHeight - shift;
  const top = anchorY - shift;
  if (!o.isLast && o.scrollOffset > 0 && bottom < anchorY) return "next";
  if (!o.isFirst && o.scrollOffset < 0 && top > anchorY * 2) return "prev";
  return null;
}
