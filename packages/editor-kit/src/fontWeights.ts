export const FONT_WEIGHTS: { value: number; label: string }[] = [
  { value: 100, label: "Thin 100" },
  { value: 200, label: "Extra light 200" },
  { value: 300, label: "Light 300" },
  { value: 400, label: "Regular 400" },
  { value: 500, label: "Medium 500" },
  { value: 600, label: "Semibold 600" },
  { value: 700, label: "Bold 700" },
  { value: 800, label: "Extra bold 800" },
  { value: 900, label: "Black 900" },
];

/** Weights to offer; filtered to `available` when given. */
export function fontWeightOptions(available?: number[]): typeof FONT_WEIGHTS {
  if (!available) return FONT_WEIGHTS;
  return FONT_WEIGHTS.filter((w) => available.includes(w.value));
}

function keywordWeight(s: string): number | null {
  const v = s.trim().toLowerCase();
  if (v === "normal") return 400;
  if (v === "bold") return 700;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * The nine weights covered by a family's @font-face `weight` descriptors
 * ("normal", "bold", "700", or a variable range "100 900"). Undefined when
 * there are none, i.e. the font's weights aren't known.
 */
export function weightsFromDescriptors(descs: string[]): number[] | undefined {
  // A face registered without descriptors reports "normal": that says nothing
  // about the weights it can render (variable fonts, synthetic bold), so it's unknown.
  if (descs.every((d) => d.trim().toLowerCase() === "normal")) return undefined;
  const out = new Set<number>();
  for (const d of descs) {
    const parts = d.trim().split(/\s+/).map(keywordWeight);
    const lo = parts[0];
    const hi = parts[1] ?? lo;
    if (lo == null || hi == null) continue;
    for (const w of FONT_WEIGHTS) if (w.value >= lo && w.value <= hi) out.add(w.value);
  }
  return out.size > 0 ? [...out].sort((a, b) => a - b) : undefined;
}

/** A text style's weight as a number ("bold" → 700; unreadable → 400). */
export function numericFontWeight(w: string | number): number {
  if (typeof w === "number") return w;
  return keywordWeight(w) ?? 400;
}
