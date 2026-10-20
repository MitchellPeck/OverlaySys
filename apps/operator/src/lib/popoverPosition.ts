export const POPOVER_W = 280;
const VIEWPORT_MARGIN = 8;
const GAP = 6;

/**
 * Fixed-position coordinates for a popover hung from an anchor: right edges
 * aligned, clamped inside the viewport, flipped above the anchor when there's
 * no room below.
 */
export function popoverPosition(
  anchor: { top: number; bottom: number; right: number },
  popoverHeight: number,
  viewport: { width: number; height: number },
  width = POPOVER_W,
): { left: number; top: number } {
  const maxLeft = viewport.width - width - VIEWPORT_MARGIN;
  const left = Math.max(VIEWPORT_MARGIN, Math.min(anchor.right - width, maxLeft));
  const below = anchor.bottom + GAP;
  const fitsBelow = below + popoverHeight <= viewport.height - VIEWPORT_MARGIN;
  const above = anchor.top - GAP - popoverHeight;
  const top = fitsBelow
    ? below
    : above >= VIEWPORT_MARGIN
      ? above
      : Math.max(VIEWPORT_MARGIN, viewport.height - popoverHeight - VIEWPORT_MARGIN);
  return { left, top };
}
