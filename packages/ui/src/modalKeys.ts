// Pure key-handling decisions for Modal, split out so they're unit-testable
// without a DOM.

/**
 * Whether Enter on the focused element should run the modal's onConfirm.
 * Textareas and contentEditable insert a newline; a focused button activates
 * itself natively (confirming too would double-fire).
 *
 * A `danger` dialog (delete, discard, replace) never confirms on a stray
 * Enter: only when the confirm button itself is the focus target
 * (`focusedIsConfirm`) — and a focused <button> already clicks natively, so in
 * practice that is the confirm's own wrapper, never an input or Cancel.
 */
export function shouldConfirmOnEnter(
  tagName: string,
  isContentEditable: boolean,
  o?: { danger?: boolean; focusedIsConfirm?: boolean },
): boolean {
  if (isContentEditable) return false;
  const tag = tagName.toUpperCase();
  if (tag === "TEXTAREA" || tag === "BUTTON") return false;
  if (o?.danger) return !!o.focusedIsConfirm;
  return true;
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

/**
 * Whether a click on the modal backdrop should close it. Both the press
 * (mousedown) and the click must land on the backdrop itself: dragging a text
 * selection out of a field releases over the backdrop (the click targets the
 * backdrop) but the press started inside the dialog, so it must not close.
 */
export function shouldCloseOnBackdropClick<T>(pressTarget: T | null, clickTarget: T, backdrop: T): boolean {
  return pressTarget === backdrop && clickTarget === backdrop;
}
