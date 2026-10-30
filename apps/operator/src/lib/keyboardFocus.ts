/**
 * Tracks which element the keyboard (Tab / Shift+Tab) focused, so the Live
 * shortcuts can leave Enter/Space to a Tab-focused button but keep driving
 * the show when the mouse focused it.
 *
 * `:focus-visible` can't tell these apart in Chromium: a key press on a
 * mouse-focused element turns it on before keydown handlers run, and so do
 * window switches and programmatic focus restores (Modal, Menu).
 *
 * Pure: the caller wires `onKeyDown` / `onFocusIn` / `onPointerDown` to the
 * DOM events of the same names.
 */
export type KeyboardFocusTracker = {
  onKeyDown(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): void;
  onFocusIn(target: unknown): void;
  onPointerDown(): void;
  /** True when `el` is the element the last Tab / Shift+Tab focused. */
  isKeyboardFocused(el: unknown): boolean;
};

export function createKeyboardFocusTracker(): KeyboardFocusTracker {
  // A Tab was pressed and its focusin hasn't arrived yet.
  let tabPending = false;
  // The element that Tab focused, until the next focus change or pointerdown.
  let tabFocused: unknown = null;
  return {
    onKeyDown(e) {
      if (e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey) tabPending = true;
    },
    onFocusIn(target) {
      tabFocused = tabPending ? target : null;
      tabPending = false;
    },
    onPointerDown() {
      tabPending = false;
      tabFocused = null;
    },
    isKeyboardFocused(el) {
      return el != null && el === tabFocused;
    },
  };
}
