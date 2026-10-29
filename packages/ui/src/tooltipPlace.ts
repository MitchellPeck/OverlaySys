/**
 * Left edge for a tooltip of measured width `w`, centred on `anchorX` and
 * clamped to [margin, viewportW - w - margin] so it never shrinks at an edge.
 */
export function tooltipLeft(anchorX: number, w: number, viewportW: number, margin = 8): number {
  const centred = anchorX - w / 2;
  return Math.max(margin, Math.min(centred, viewportW - w - margin));
}
