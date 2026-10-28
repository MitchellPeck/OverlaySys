import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Guards the WCAG AA (4.5:1) text-contrast fixes in globals.css so a later
// palette tweak can't silently regress them.

const css = readFileSync(path.join(__dirname, "globals.css"), "utf8");

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

describe("charcoal palette", () => {
  it("uses the charcoal surfaces from the spec", () => {
    expect([cssVar("bg"), cssVar("surface"), cssVar("surface-2"), cssVar("control"), cssVar("border")])
      .toEqual(["#1b1b1d", "#202022", "#242426", "#3a3a3e", "#333336"]);
  });
  it("--text and --text-dim are AA on --control", () => {
    for (const fg of ["text", "text-dim"]) expect(contrast(cssVar(fg), cssVar("control"))).toBeGreaterThanOrEqual(4.5);
  });
  it("--danger-text is AA on every surface", () => {
    for (const bg of SURFACES) expect(contrast(cssVar("danger-text"), cssVar(bg)), bg).toBeGreaterThanOrEqual(4.5);
  });
  it("white is AA on --ok-fill", () => expect(contrast("#ffffff", cssVar("ok-fill"))).toBeGreaterThanOrEqual(4.5));
  it("defines every kind colour", () => {
    expect(["graphic", "song", "slides", "scripture", "video", "section"].map((k) => cssVar(`kind-${k}`)))
      .toEqual(["#60a5fa", "#f5b942", "#34d399", "#f472b6", "#a78bfa", "#8e8e94"]);
  });
  it("has no hover-only row actions", () => expect(css).not.toMatch(/\.row-actions\s*\{[^}]*opacity:\s*0/));
  it("keeps sub-nav labels at every width", () => expect(css).not.toMatch(/\.shell-subnav-label\s*\{\s*display:\s*none/));
});
