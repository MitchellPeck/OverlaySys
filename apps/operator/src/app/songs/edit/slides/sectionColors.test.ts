import { describe, expect, it } from "vitest";
import { sectionChipTextColor, sectionKindColor } from "./sectionColors";

function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
function contrastRatio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe("sectionColors", () => {
  it.each(Object.entries(sectionKindColor))("%s chip text has ≥ 4.5:1 contrast", (_k, bg) =>
    expect(contrastRatio(sectionChipTextColor(bg), bg)).toBeGreaterThanOrEqual(4.5));
  it("no section colour is the on-air red or the preview green", () => {
    for (const c of Object.values(sectionKindColor)) {
      expect(["#e5484d", "#30a46c", "var(--onair)", "var(--ok)"]).not.toContain(c);
    }
  });
});
