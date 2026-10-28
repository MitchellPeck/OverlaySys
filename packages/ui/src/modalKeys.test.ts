import { describe, expect, it } from "vitest";
import { nextTrapFocus, shouldConfirmOnEnter } from "./modalKeys";

describe("shouldConfirmOnEnter", () => {
  it("confirms from inputs and the dialog body", () => {
    expect(shouldConfirmOnEnter("INPUT", false)).toBe(true);
    expect(shouldConfirmOnEnter("div", false)).toBe(true);
  });
  it("leaves textareas, contentEditable and buttons alone", () => {
    expect(shouldConfirmOnEnter("TEXTAREA", false)).toBe(false);
    expect(shouldConfirmOnEnter("DIV", true)).toBe(false);
    expect(shouldConfirmOnEnter("BUTTON", false)).toBe(false);
  });
});

describe("shouldConfirmOnEnter with danger", () => {
  it("confirms a dangerous dialog only when the confirm button is focused", () => {
    expect(shouldConfirmOnEnter("INPUT", false, { danger: true, focusedIsConfirm: false })).toBe(false);
    expect(shouldConfirmOnEnter("BUTTON", false, { danger: true, focusedIsConfirm: true })).toBe(false); // native click already fires
    expect(shouldConfirmOnEnter("DIV", false, { danger: true, focusedIsConfirm: true })).toBe(true);
    expect(shouldConfirmOnEnter("INPUT", false)).toBe(true);
  });
});

describe("nextTrapFocus", () => {
  it("wraps forward from the last and backward from the first", () => {
    expect(nextTrapFocus(3, 2, false)).toBe(0);
    expect(nextTrapFocus(3, 0, true)).toBe(2);
  });
  it("lets the browser move within the dialog", () => {
    expect(nextTrapFocus(3, 1, false)).toBeNull();
    expect(nextTrapFocus(3, 1, true)).toBeNull();
  });
  it("enters the dialog when focus is on the container", () => {
    expect(nextTrapFocus(3, -1, false)).toBe(0);
    expect(nextTrapFocus(3, -1, true)).toBe(2);
  });
  it("stays put with nothing focusable", () => {
    expect(nextTrapFocus(0, -1, false)).toBe(-1);
  });
});
