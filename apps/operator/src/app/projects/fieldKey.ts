/** Lowercase snake_case key of ASCII letters and digits; collisions get `_2`, `_3`, … */
export function deriveFieldKey(label: string, existing: string[]): string {
  const base =
    label
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "field";
  const taken = new Set(existing.map((k) => k.trim().toLowerCase()));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
