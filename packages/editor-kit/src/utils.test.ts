import { describe, expect, it } from "vitest";
import { isEditableTarget } from "./utils";

const el = (tagName: string, isContentEditable = false) => ({ tagName, isContentEditable }) as unknown as Element;

describe("isEditableTarget", () => {
  it("is true for text controls and contenteditable", () => {
    expect(isEditableTarget(el("INPUT"))).toBe(true);
    expect(isEditableTarget(el("TEXTAREA"))).toBe(true);
    expect(isEditableTarget(el("SELECT"))).toBe(true);
    expect(isEditableTarget(el("DIV", true))).toBe(true);
  });
  it("is false for other elements and nothing", () => {
    expect(isEditableTarget(el("DIV"))).toBe(false);
    expect(isEditableTarget(el("BUTTON"))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(undefined)).toBe(false);
  });
});
