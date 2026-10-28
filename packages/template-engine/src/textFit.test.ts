import { describe, expect, it } from "vitest";
import { ellipsisLines, fitFontSize } from "./textFit";
import { wipeToCss } from "./gsap-timeline";

describe("fitFontSize", () => {
  it("keeps the max size when it fits", () => {
    expect(fitFontSize(48, 12, () => true)).toBe(48);
  });
  it("finds the largest fitting size", () => {
    expect(fitFontSize(48, 12, (s) => s <= 30)).toBe(30);
  });
  it("bottoms out at the minimum", () => {
    expect(fitFontSize(48, 12, () => false)).toBe(12);
  });
  it("handles min >= max", () => {
    expect(fitFontSize(10, 12, () => false)).toBe(10);
  });
});

describe("ellipsisLines", () => {
  it("counts whole lines in the box", () => {
    expect(ellipsisLines(100, 20, 1.2)).toBe(4); // 24px lines
    expect(ellipsisLines(96, 20, 1.2)).toBe(4);
    expect(ellipsisLines(95, 20, 1.2)).toBe(3);
  });
  it("always allows one line", () => {
    expect(ellipsisLines(5, 48, 1.1)).toBe(1);
    expect(ellipsisLines(0, 48, 1.1)).toBe(1);
  });
});

describe("wipeToCss", () => {
  it("maps 0..1 to a clamped percentage", () => {
    expect(wipeToCss(0)).toBe("0%");
    expect(wipeToCss(0.5)).toBe("50%");
    expect(wipeToCss(2)).toBe("100%");
    expect(wipeToCss("0.25")).toBe("25%");
    expect(wipeToCss("junk")).toBe("100%");
  });
});
