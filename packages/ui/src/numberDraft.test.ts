import { describe, it, expect } from "vitest";
import { roundTo, formatNumber, decimalsFor, parseDraft, stepValue } from "./numberDraft";

describe("numberDraft", () => {
  it("roundTo", () => {
    expect(roundTo(460.00000000000006, 2)).toBe(460);
    expect(roundTo(1169.9115, 2)).toBe(1169.91);
    expect(roundTo(-0.5, 0)).toBe(-1);
  });
  it("formatNumber", () => {
    expect(formatNumber(0.30000000000000004, 2)).toBe("0.3");
    expect(formatNumber(12.5, 2)).toBe("12.5");
  });
  it("decimalsFor", () => {
    expect(decimalsFor(0.1, false, 3)).toBe(3);
    expect(decimalsFor(0.1, true)).toBe(0);
    expect(decimalsFor(0.1)).toBe(1);
    expect(decimalsFor(0.25)).toBe(2);
    expect(decimalsFor()).toBe(2);
  });
  it("parseDraft", () => {
    expect(parseDraft(" 3,5 ", { step: 0.5 })).toBe(3.5);
    expect(parseDraft("abc", {})).toBeNull();
    expect(parseDraft("", {})).toBeNull();
    expect(parseDraft("250", { max: 100 })).toBe(100);
    expect(parseDraft("2.6", { int: true })).toBe(3);
  });
  it("stepValue", () => {
    expect(stepValue(1, 1, { step: 0.1 })).toBe(1.1);
    expect(stepValue(5, -1, { step: 1, min: 0, big: true })).toBe(0);
  });
});
