import type { Template } from "@overlaysys/core";

/**
 * Pure helper extracted for testability — does this family need to be
 * registered, given the set of family names already loaded?
 */
export function needsLoad(family: string, loaded: Set<string>): boolean {
  if (!family.trim()) return false;
  return !loaded.has(family);
}

/**
 * Collect the set of font-family names already registered with the document.
 * Returns an empty set on platforms without `document.fonts` (SSR, tests).
 */
function loadedFamilies(): Set<string> {
  const out = new Set<string>();
  if (typeof document === "undefined" || !("fonts" in document)) return out;
  document.fonts.forEach((f) => out.add(f.family));
  return out;
}

/**
 * Register every entry in `template.fonts` via the FontFace API and start
 * loading them. Returns a promise that resolves when every font has either
 * loaded or failed — failures log and continue, so a single bad font never
 * blocks template mount.
 *
 * The browser repaints text automatically once a face resolves, so callers
 * can mount synchronously and let this run in the background.
 */
export async function ensureTemplateFonts(template: Template): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  if (typeof FontFace === "undefined") return;

  const loaded = loadedFamilies();
  const tasks: Promise<unknown>[] = [];

  for (const entry of template.fonts) {
    if (!needsLoad(entry.family, loaded)) continue;
    if (!entry.src) continue;
    try {
      const face = new FontFace(entry.family, `url(${entry.src})`);
      document.fonts.add(face);
      tasks.push(
        face.load().catch((err) => {
          console.warn(
            `[overlaysys] failed to load font "${entry.family}":`,
            err,
          );
        }),
      );
    } catch (err) {
      console.warn(
        `[overlaysys] could not register font "${entry.family}":`,
        err,
      );
    }
  }

  await Promise.all(tasks);
}
