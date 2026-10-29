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
});
