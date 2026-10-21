import { describe, expect, it } from "vitest";
import {
  budgetForPref, budgetChanged, clampCustomChars, parseSlideSizePref, loadSlideSizePref, DEFAULT_SLIDE_SIZE_PREF,
} from "./slideSizePref";

describe("slideSizePref", () => {
  it("presets map to the scripture presets", () => {
    expect(budgetForPref({ kind: "short" })).toEqual({ maxChars: 120 });
    expect(budgetForPref({ kind: "medium" })).toEqual({ maxChars: 240 });
    expect(budgetForPref({ kind: "long" })).toEqual({ maxChars: 360 });
  });

  it("custom is clamped", () => {
    expect(budgetForPref({ kind: "custom", maxChars: 10 })).toEqual({ maxChars: 40 });
    expect(budgetForPref({ kind: "custom", maxChars: 99999 })).toEqual({ maxChars: 2000 });
    expect(clampCustomChars(Number.NaN)).toBe(240);
    expect(clampCustomChars(0)).toBe(240);
    expect(clampCustomChars(150.6)).toBe(151);
  });

  it("parse falls back to medium on garbage", () => {
    expect(parseSlideSizePref(null)).toEqual(DEFAULT_SLIDE_SIZE_PREF);
    expect(parseSlideSizePref("not json")).toEqual(DEFAULT_SLIDE_SIZE_PREF);
    expect(parseSlideSizePref('{"kind":"huge"}')).toEqual(DEFAULT_SLIDE_SIZE_PREF);
    expect(parseSlideSizePref('{"kind":"custom","maxChars":"x"}')).toEqual({ kind: "custom", maxChars: 240 });
  });

  it("parse round-trips valid prefs", () => {
    expect(parseSlideSizePref('{"kind":"long"}')).toEqual({ kind: "long" });
    expect(parseSlideSizePref('{"kind":"custom","maxChars":180}')).toEqual({ kind: "custom", maxChars: 180 });
  });

  it("load returns the default when localStorage is unavailable (node)", () => {
    expect(loadSlideSizePref()).toEqual(DEFAULT_SLIDE_SIZE_PREF);
  });

  it("budgetChanged is false when switching to Custom at the same size", () => {
    expect(budgetChanged(budgetForPref({ kind: "medium" }), budgetForPref({ kind: "custom", maxChars: 240 }))).toBe(false);
    expect(budgetChanged(budgetForPref({ kind: "medium" }), budgetForPref({ kind: "short" }))).toBe(true);
    expect(budgetChanged({ maxChars: 240 }, { maxChars: 240, maxLines: 2 })).toBe(true);
  });
});
