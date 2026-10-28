import { describe, expect, it } from "vitest";
import { isContextMenuKey, isEnabled, menuAnchorForEvent, nextMenuIndex, placeMenu, type MenuItem } from "./menuModel";

const items: MenuItem[] = [
  { id: "a", label: "Open", onSelect() {} },
  { separator: true },
  { id: "b", label: "Rename", disabled: "Not connected", onSelect() {} },
  { id: "c", label: "Delete", danger: true, onSelect() {} },
];

describe("nextMenuIndex", () => {
  it("skips separators and disabled, wraps, handles Home/End", () => {
    expect(nextMenuIndex(items, 0, "ArrowDown")).toBe(3);
    expect(nextMenuIndex(items, 3, "ArrowDown")).toBe(0);
    expect(nextMenuIndex(items, 0, "ArrowUp")).toBe(3);
    expect(nextMenuIndex(items, 3, "Home")).toBe(0);
    expect(nextMenuIndex(items, 0, "End")).toBe(3);
  });
  it("returns -1 when nothing is enabled", () => {
    expect(nextMenuIndex([{ separator: true }], -1, "ArrowDown")).toBe(-1);
    expect(isEnabled(items[2]!)).toBe(false);
  });
});

describe("placeMenu", () => {
  const vp = { w: 1440, h: 900 };
  const size = { w: 200, h: 160 };
  it("flips up/left near the viewport edge", () => {
    expect(placeMenu({ x: 1400, y: 880 }, size, vp)).toEqual({ x: 1200, y: 720 });
  });
  it("opens below-right of a point", () => {
    expect(placeMenu({ x: 10, y: 10 }, size, vp)).toEqual({ x: 10, y: 10 });
  });
  it("opens below an element, right-aligned, and flips up", () => {
    expect(placeMenu({ x: 300, y: 100, w: 28, h: 28 }, size, vp)).toEqual({ x: 128, y: 128 });
    expect(placeMenu({ x: 300, y: 850, w: 28, h: 28 }, size, vp)).toEqual({ x: 128, y: 690 });
  });
  it("clamps inside the margin", () => {
    expect(placeMenu({ x: 20, y: 100, w: 28, h: 28 }, size, vp).x).toBe(8);
  });
});

describe("menuAnchorForEvent / isContextMenuKey", () => {
  it("anchors keyboard-originated events to the element", () => {
    expect(menuAnchorForEvent({ type: "click", detail: 0, clientX: 40, clientY: 50 })).toBe("element");
    expect(menuAnchorForEvent({ type: "click", detail: 1, clientX: 0, clientY: 0 })).toBe("element");
    expect(menuAnchorForEvent({ type: "contextmenu", detail: 0, clientX: 0, clientY: 0 })).toBe("element");
  });
  it("anchors real mouse events to the point", () => {
    expect(menuAnchorForEvent({ type: "click", detail: 1, clientX: 40, clientY: 50 })).toBe("point");
    expect(menuAnchorForEvent({ type: "contextmenu", detail: 0, clientX: 40, clientY: 50 })).toBe("point");
  });
  it("detects ContextMenu and Shift+F10", () => {
    expect(isContextMenuKey({ key: "ContextMenu", shiftKey: false })).toBe(true);
    expect(isContextMenuKey({ key: "F10", shiftKey: true })).toBe(true);
    expect(isContextMenuKey({ key: "F10", shiftKey: false })).toBe(false);
  });
});
