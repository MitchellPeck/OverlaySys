import type { SectionKind } from "@overlaysys/core";

// Section chip palette. No red (on air) or green (preview): those carry air meaning.
export const sectionKindColor: Record<SectionKind, string> = {
  verse: "#8b9cf8",
  chorus: "#f0a35e",
  bridge: "#c084fc",
  tag: "#2dd4bf",
  intro: "#94a3b8",
  outro: "#94a3b8",
  other: "#8e8e94",
};

const DARK = "#111113";
const LIGHT = "#ffffff";

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h, 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

function ratio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Chip text colour: whichever of near-black / white has the higher contrast on `bg`. */
export function sectionChipTextColor(bg: string): string {
  return ratio(DARK, bg) >= ratio(LIGHT, bg) ? DARK : LIGHT;
}
