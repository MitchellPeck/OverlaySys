import { describe, expect, it } from "vitest";
import { fitFontSize, searchFontSize } from "./fitText";

describe("searchFontSize", () => {
  it("returns max when it already fits", () => {
    expect(searchFontSize(80, 12, () => true)).toBe(80);
  });
  it("finds the largest size that fits", () => {
    expect(searchFontSize(80, 12, (s) => s <= 37)).toBe(37);
  });
  it("returns min when nothing fits", () => {
    expect(searchFontSize(80, 12, () => false)).toBe(12);
  });
  it("never returns more than max when the floor is larger", () => {
    expect(searchFontSize(36, 48, () => false)).toBe(36);
  });
  it("probes O(log n) sizes", () => {
    let calls = 0;
    searchFontSize(200, 10, (s) => {
      calls++;
      return s <= 100;
    });
    expect(calls).toBeLessThanOrEqual(10);
  });
});

describe("fitFontSize", () => {
  it("holds the 48 px floor for a long message and asks to grow", () => {
    const r = fitFontSize("x".repeat(300), { w: 1872, h: 88 }, 52);
    expect(r.px).toBe(48);
    expect(r.wrap).toBe(true);
    expect(r.grow).toBeGreaterThan(1);
    expect(r.grow).toBeLessThanOrEqual(2);
  });
  it("short text keeps the max and does not grow", () => {
    expect(fitFontSize("Hello", { w: 1872, h: 88 }, 52)).toEqual({ px: 52, wrap: false, grow: 1 });
  });
  it("caps grow at 2", () => {
    expect(fitFontSize("x".repeat(5000), { w: 400, h: 60 }, 52).grow).toBe(2);
  });
});
