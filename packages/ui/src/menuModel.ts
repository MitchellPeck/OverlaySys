import type { ReactNode } from "react";

export type MenuItem =
  | {
      id: string;
      label: string;
      icon?: ReactNode;
      danger?: boolean;
      /** true = disabled; a string = disabled, shown as a tooltip reason. */
      disabled?: boolean | string;
      shortcut?: string;
      onSelect(): void;
    }
  | { separator: true };

export function isEnabled(item: MenuItem): boolean {
  return !("separator" in item) && !item.disabled;
}

/** Next enabled index for a navigation key (skips separators/disabled, wraps). -1 when none. */
export function nextMenuIndex(
  items: MenuItem[],
  active: number,
  key: "ArrowDown" | "ArrowUp" | "Home" | "End",
): number {
  const n = items.length;
  if (!items.some(isEnabled)) return -1;
  if (key === "Home") return items.findIndex(isEnabled);
  if (key === "End") {
    for (let i = n - 1; i >= 0; i--) if (isEnabled(items[i]!)) return i;
  }
  const step = key === "ArrowUp" ? -1 : 1;
  let i = active;
  for (let c = 0; c < n; c++) {
    i = (i + step + n) % n;
    if (isEnabled(items[i]!)) return i;
  }
  return -1;
}

/**
 * Menu top-left for an anchor. A point opens below-right; an element (w/h given)
 * opens below with right edges aligned (extends left). Flips up/left on
 * overflow, then clamps inside the margin.
 */
export function placeMenu(
  anchor: { x: number; y: number; w?: number; h?: number },
  size: { w: number; h: number },
  viewport: { w: number; h: number },
  margin = 8,
): { x: number; y: number } {
  const isEl = anchor.w !== undefined || anchor.h !== undefined;
  let x = isEl ? anchor.x + (anchor.w ?? 0) - size.w : anchor.x;
  let y = anchor.y + (anchor.h ?? 0);
  if (!isEl && x + size.w > viewport.w - margin) x = anchor.x - size.w;
  if (y + size.h > viewport.h - margin) y = anchor.y - size.h;
  x = Math.max(margin, Math.min(x, viewport.w - margin - size.w));
  y = Math.max(margin, Math.min(y, viewport.h - margin - size.h));
  return { x, y };
}

/** True for the ContextMenu key or Shift+F10 — open the menu at the focused element's rect. */
export function isContextMenuKey(e: { key: string; shiftKey: boolean }): boolean {
  return e.key === "ContextMenu" || (e.shiftKey && e.key === "F10");
}

/** Keyboard-originated mouse events (Enter/Space on a button, ContextMenu key) have detail 0 or no position. */
export function menuAnchorForEvent(e: {
  type: string;
  detail?: number;
  clientX: number;
  clientY: number;
}): "point" | "element" {
  if (e.clientX === 0 && e.clientY === 0) return "element";
  if (e.type === "click" && e.detail === 0) return "element";
  return "point";
}
