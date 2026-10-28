// Pure key-handling decisions for Modal, split out so they're unit-testable
// without a DOM.

/**
 * Whether Enter on the focused element should run the modal's onConfirm.
 * Textareas and contentEditable insert a newline; a focused button activates
 * itself natively (confirming too would double-fire).
 */
export function shouldConfirmOnEnter(tagName: string, isContentEditable: boolean): boolean {
  if (isContentEditable) return false;
  const tag = tagName.toUpperCase();
  return tag !== "TEXTAREA" && tag !== "BUTTON";
}

/**
 * Focus-trap step for Tab / Shift+Tab. `current` is the focused element's
 * index among the dialog's focusables (-1 when focus is on the dialog itself
 * or elsewhere). Returns the index to focus, -1 to keep focus where it is
 * (no focusables), or null to let the browser move focus normally.
 */
export function nextTrapFocus(count: number, current: number, shift: boolean): number | null {
  if (count === 0) return -1;
  if (current < 0) return shift ? count - 1 : 0;
  if (!shift && current === count - 1) return 0;
  if (shift && current === 0) return count - 1;
  return null;
}
