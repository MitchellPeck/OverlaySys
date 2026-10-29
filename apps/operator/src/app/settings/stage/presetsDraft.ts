/** First blank preset (1-based) as an error string; null when all are filled. */
export function presetsInvalidReason(presets: string[]): string | null {
  const i = presets.findIndex((p) => p.trim() === "");
  return i === -1 ? null : `Preset ${i + 1} is empty`;
}

/** Swap preset i with its neighbour; returns the same order at the edges. */
export function movePreset(presets: string[], i: number, dir: -1 | 1): string[] {
  const j = i + dir;
  if (i < 0 || i >= presets.length || j < 0 || j >= presets.length) return presets;
  const n = [...presets];
  [n[i], n[j]] = [n[j]!, n[i]!];
  return n;
}
