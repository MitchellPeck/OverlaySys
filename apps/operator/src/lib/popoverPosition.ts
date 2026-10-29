export const POPOVER_W = 280;
const VIEWPORT_MARGIN = 8;
const GAP = 6;

/**
 * Fixed-position coordinates for a popover hung from an anchor: right edges
 * aligned, clamped inside the viewport, flipped above the anchor when there's
 * no room below.
 */
export function popoverPosition(
  anchor: { top: number; bottom: number; right: number; left?: number },
  popoverHeight: number,
  viewport: { width: number; height: number },
  width = POPOVER_W,
  placement: "below" | "left" = "below",
): { left: number; top: number } {
  if (placement === "left") {
    // Beside the anchor (to its left), top-aligned, clamped into the viewport.
    const aLeft = anchor.left ?? anchor.right;
    const left = Math.max(VIEWPORT_MARGIN, aLeft - GAP - width);
    const top = Math.max(VIEWPORT_MARGIN, Math.min(anchor.top, viewport.height - popoverHeight - VIEWPORT_MARGIN));
    return { left, top };
  }
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

/**
 * Nudge a popover down so it doesn't cover `avoid` (e.g. the PGM/PVW monitors).
 * Only moves it when they actually overlap; if it then won't fit above the
 * viewport bottom it goes as low as it can, and may overlap again.
 */
export function popoverAvoiding(
  pos: { left: number; top: number },
  size: { width: number; height: number },
  avoid: { left: number; right: number; top: number; bottom: number } | null,
  viewportHeight: number,
): { left: number; top: number } {
  if (!avoid) return pos;
  const overlaps =
    pos.left < avoid.right && pos.left + size.width > avoid.left && pos.top < avoid.bottom && pos.top + size.height > avoid.top;
  if (!overlaps) return pos;
  const top = Math.min(avoid.bottom + GAP + 2, Math.max(VIEWPORT_MARGIN, viewportHeight - size.height - VIEWPORT_MARGIN));
  return { left: pos.left, top: Math.max(top, pos.top) };
}
