import { describe, it, expect } from "vitest";
import { colors, radius, fontFamily, space } from "./tokens";

describe("token backward-compatibility contract", () => {
  it("keeps the 4/8/12/16 spacing steps the console relies on", () => {
    expect([space[1], space[2], space[3], space[4]]).toEqual([4, 8, 12, 16]);
  });

  it("preserves every pre-overhaul color name as a CSS var", () => {
    const legacy = [
      "bg", "panel", "panel2", "border", "text", "textDim",
      "accent", "accent2", "green", "red", "warn", "errorText",
    ] as const;
    for (const key of legacy) {
      expect(colors[key], key).toMatch(/^var\(--/);
    }
  });

  it("flips legacy accent to the indigo brand", () => {
    expect(colors.accent).toBe("var(--brand)");
    expect(colors.accent).toBe(colors.brand);
  });

  it("adds the new console color names", () => {
    const added = [
      "surface", "surface2", "surface3", "borderStrong", "textMuted",
      "brand", "brandHover", "brandSubtle", "ok", "okSubtle", "onair", "gradBrand",
    ] as const;
    for (const key of added) {
      expect(colors[key], key).toMatch(/^var\(--/);
    }
  });

  it("exposes Geist font-family tokens", () => {
    expect(fontFamily.sans).toContain("Geist");
    expect(fontFamily.mono).toContain("Geist Mono");
  });

  it("uses the 10px radius family", () => {
    expect(radius.lg).toBe(10);
  });
});
