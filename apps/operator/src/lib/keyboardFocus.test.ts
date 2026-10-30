import { describe, expect, it } from "vitest";
import { createKeyboardFocusTracker } from "./keyboardFocus";
import { isActivatableTarget } from "./shortcutGuards";

const tab = { key: "Tab", metaKey: false, ctrlKey: false, altKey: false };
const shiftTab = { ...tab, shiftKey: true };
const space = { key: " ", metaKey: false, ctrlKey: false, altKey: false };

describe("createKeyboardFocusTracker", () => {
  it("a mouse-focused button is not keyboard-focused, so Space still drives the show", () => {
    const t = createKeyboardFocusTracker();
    const btn = { tagName: "BUTTON" };
    t.onPointerDown();
    t.onFocusIn(btn);
    t.onKeyDown(space);
    expect(t.isKeyboardFocused(btn)).toBe(false);
    expect(isActivatableTarget(btn, t.isKeyboardFocused(btn))).toBe(false);
  });

  it("a Tab-focused button is exempt for Enter/Space", () => {
    const t = createKeyboardFocusTracker();
    const btn = { tagName: "BUTTON" };
    t.onKeyDown(tab);
    t.onFocusIn(btn);
    expect(t.isKeyboardFocused(btn)).toBe(true);
    expect(isActivatableTarget(btn, t.isKeyboardFocused(btn))).toBe(true);
  });

  it("Shift+Tab counts as keyboard focus too", () => {
    const t = createKeyboardFocusTracker();
    const btn = { tagName: "BUTTON" };
    t.onKeyDown(shiftTab);
    t.onFocusIn(btn);
    expect(t.isKeyboardFocused(btn)).toBe(true);
  });

  it("only the element the Tab landed on counts, not a later programmatic focus", () => {
    const t = createKeyboardFocusTracker();
    const a = { tagName: "BUTTON" };
    const b = { tagName: "BUTTON" };
    t.onKeyDown(tab);
    t.onFocusIn(a);
    t.onFocusIn(b); // e.g. a Modal/Menu restoring focus
    expect(t.isKeyboardFocused(a)).toBe(false);
    expect(t.isKeyboardFocused(b)).toBe(false);
  });

  it("a pointerdown after Tab clears the exemption", () => {
    const t = createKeyboardFocusTracker();
    const btn = { tagName: "BUTTON" };
    t.onKeyDown(tab);
    t.onFocusIn(btn);
    t.onPointerDown();
    expect(t.isKeyboardFocused(btn)).toBe(false);
  });

  it("a pointerdown between the Tab and the focusin cancels it", () => {
    const t = createKeyboardFocusTracker();
    const btn = { tagName: "BUTTON" };
    t.onKeyDown(tab);
    t.onPointerDown();
    t.onFocusIn(btn);
    expect(t.isKeyboardFocused(btn)).toBe(false);
  });

  it("⌘/Ctrl/Alt+Tab is not focus navigation", () => {
    const t = createKeyboardFocusTracker();
    const btn = { tagName: "BUTTON" };
    t.onKeyDown({ ...tab, ctrlKey: true });
    t.onFocusIn(btn);
    expect(t.isKeyboardFocused(btn)).toBe(false);
  });

  it("nothing is keyboard-focused for a null target", () => {
    const t = createKeyboardFocusTracker();
    t.onKeyDown(tab);
    expect(t.isKeyboardFocused(null)).toBe(false);
  });
});
