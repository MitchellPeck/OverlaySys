import { describe, expect, it } from "vitest";
import { fitFontSize } from "./fitText";

describe("fitFontSize", () => {
  it("returns max when it already fits", () => {
    expect(fitFontSize(80, 12, () => true)).toBe(80);
  });
  it("finds the largest size that fits", () => {
    expect(fitFontSize(80, 12, (s) => s <= 37)).toBe(37);
  });
  it("returns min when nothing fits", () => {
    expect(fitFontSize(80, 12, () => false)).toBe(12);
  });
  it("probes O(log n) sizes", () => {
    let calls = 0;
    fitFontSize(200, 10, (s) => {
      calls++;
      return s <= 100;
    });
    expect(calls).toBeLessThanOrEqual(10);
  });
});
