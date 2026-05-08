const SYSTEM_FALLBACKS = [
  "Inter",
  "system-ui",
  "Arial",
  "Georgia",
  "Times New Roman",
] as const;

export function fontFamilyFromFilename(name: string): string {
  // Strip extension (only the last one — covers .woff2/.woff/.ttf/.otf).
  const noExt = name.replace(/\.[^./\\]+$/, "");
  // Replace separators with spaces, collapse whitespace, trim.
  const cleaned = noExt.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return "Custom Font";
  // Title-case each word.
  return cleaned
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function fontPickerOptions(
  templateFonts: { family: string; src: string }[],
  currentFamily: string,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of SYSTEM_FALLBACKS) {
    if (!seen.has(f)) {
      seen.add(f);
      out.push(f);
    }
  }
  for (const f of templateFonts) {
    if (!seen.has(f.family)) {
      seen.add(f.family);
      out.push(f.family);
    }
  }
  if (currentFamily && !seen.has(currentFamily)) {
    out.push(currentFamily);
  }
  return out;
}
