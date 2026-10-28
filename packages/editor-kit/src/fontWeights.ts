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
