import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Guards the WCAG AA (4.5:1) text-contrast fixes in globals.css so a later
// palette tweak can't silently regress them.

const css = readFileSync(path.join(__dirname, "..", "globals.css"), "utf8");

function cssVar(name: string): string {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(css);
  if (!m?.[1]) throw new Error(`--${name} is not a #rrggbb literal in globals.css`);
  return m[1];
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = ["bg", "surface", "surface-2", "surface-3"];

describe("operator palette contrast", () => {
  for (const fg of ["text", "text-dim", "text-muted", "brand-text"]) {
    it(`--${fg} is AA on every surface`, () => {
      for (const bg of SURFACES) {
        expect(contrast(cssVar(fg), cssVar(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it("white text on the on-air and brand fills is AA", () => {
    expect(contrast("#ffffff", cssVar("onair-fill"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#ffffff", cssVar("brand-fill"))).toBeGreaterThanOrEqual(4.5);
  });

  it("has a reduced-motion rule", () => {
    expect(css).toContain("prefers-reduced-motion: reduce");
  });
});
