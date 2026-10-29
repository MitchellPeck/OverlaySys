import { describe, expect, it } from "vitest";
import { draftReducer, isDirty, saveBarProps, type DraftState } from "./settingsDraft";

const empty: DraftState<{ a: number; b: string }> = { saved: null, draft: null, saving: false, error: null };
const loaded = draftReducer(empty, { type: "loaded", value: { a: 1, b: "x" } });

describe("settingsDraft", () => {
  it("loaded then edit makes isDirty true", () => {
    expect(isDirty(loaded)).toBe(false);
    expect(isDirty(draftReducer(loaded, { type: "edit", value: { a: 2, b: "x" } }))).toBe(true);
  });
  it("edit back to the saved value is clean (key order ignored)", () => {
    const s = draftReducer(draftReducer(loaded, { type: "edit", value: { a: 2, b: "x" } }), {
      type: "edit",
      value: { b: "x", a: 1 },
    });
    expect(isDirty(s)).toBe(false);
  });
  it("saveStart then saveOk sets saved = draft = v", () => {
    let s = draftReducer(loaded, { type: "edit", value: { a: 2, b: "x" } });
    s = draftReducer(s, { type: "saveStart" });
    expect(s.saving).toBe(true);
    s = draftReducer(s, { type: "saveOk", value: { a: 3, b: "y" } });
    expect(s.saved).toEqual({ a: 3, b: "y" });
    expect(s.draft).toEqual({ a: 3, b: "y" });
    expect(s.saving).toBe(false);
    expect(isDirty(s)).toBe(false);
  });
  it("saveFail keeps the draft dirty", () => {
    let s = draftReducer(loaded, { type: "edit", value: { a: 2, b: "x" } });
    s = draftReducer(s, { type: "saveStart" });
    s = draftReducer(s, { type: "saveFail", error: "boom" });
    expect(s.draft).toEqual({ a: 2, b: "x" });
    expect(s.error).toBe("boom");
    expect(s.saving).toBe(false);
    expect(isDirty(s)).toBe(true);
  });
  it("revert restores saved", () => {
    const s = draftReducer(draftReducer(loaded, { type: "edit", value: { a: 9, b: "z" } }), { type: "revert" });
    expect(s.draft).toEqual({ a: 1, b: "x" });
    expect(isDirty(s)).toBe(false);
  });
  it("saveBarProps offline", () => {
    const s = draftReducer(loaded, { type: "edit", value: { a: 2, b: "x" } });
    expect(saveBarProps(s, { connected: false }).disabledReason).toBe("Reconnect to save");
    expect(saveBarProps(s, { connected: false }).dirty).toBe(true);
  });
  it("invalidReason takes precedence when connected", () => {
    const s = draftReducer(loaded, { type: "edit", value: { a: 2, b: "x" } });
    expect(saveBarProps(s, { connected: true, invalidReason: "Preset 2 is empty" }).disabledReason).toBe(
      "Preset 2 is empty",
    );
    expect(saveBarProps(s, { connected: true }).disabledReason).toBeUndefined();
  });
  it("loaded while dirty keeps the draft, updates the baseline and flags it", () => {
    const dirty = draftReducer(loaded, { type: "edit", value: { a: 2, b: "x" } });
    const s = draftReducer(dirty, { type: "loaded", value: { a: 5, b: "x" } });
    expect(s.draft).toEqual({ a: 2, b: "x" });
    expect(s.saved).toEqual({ a: 5, b: "x" });
    expect(s.changedElsewhere).toBe(true);
    expect(isDirty(s)).toBe(true);
  });
  it("loaded while clean adopts the new value", () => {
    const s = draftReducer(loaded, { type: "loaded", value: { a: 7, b: "q" } });
    expect(s.draft).toEqual({ a: 7, b: "q" });
    expect(s.changedElsewhere).toBeFalsy();
  });
  it("two functional updates in one tick both apply", () => {
    let s = draftReducer(loaded, { type: "update", fn: (p) => ({ ...p, a: p.a + 1 }) });
    s = draftReducer(s, { type: "update", fn: (p) => ({ ...p, a: p.a + 1 }) });
    expect(s.draft).toEqual({ a: 3, b: "x" });
  });
});
