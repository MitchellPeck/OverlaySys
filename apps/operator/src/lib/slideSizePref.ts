import { SLIDE_SIZE_PRESETS, type SlideBudget, type SlideSizePreset } from "@overlaysys/scripture";

/** How much scripture text goes on each slide; remembered per operator. */
export type SlideSizePref = { kind: SlideSizePreset } | { kind: "custom"; maxChars: number };

export const DEFAULT_SLIDE_SIZE_PREF: SlideSizePref = { kind: "medium" };

const STORAGE_KEY = "overlaysys.scripture.slideSize";

export function clampCustomChars(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return SLIDE_SIZE_PRESETS.medium.maxChars;
  return Math.min(2000, Math.max(40, Math.round(n)));
}

export function parseSlideSizePref(raw: string | null): SlideSizePref {
  if (!raw) return DEFAULT_SLIDE_SIZE_PREF;
  try {
    const v = JSON.parse(raw) as { kind?: unknown; maxChars?: unknown };
    if (v.kind === "short" || v.kind === "medium" || v.kind === "long") return { kind: v.kind };
    if (v.kind === "custom") return { kind: "custom", maxChars: clampCustomChars(Number(v.maxChars)) };
  } catch {
    // fall through to the default
  }
  return DEFAULT_SLIDE_SIZE_PREF;
}

export function budgetForPref(pref: SlideSizePref): SlideBudget {
  return pref.kind === "custom"
    ? { maxChars: clampCustomChars(pref.maxChars) }
    : SLIDE_SIZE_PRESETS[pref.kind];
}

export function loadSlideSizePref(): SlideSizePref {
  try {
    return parseSlideSizePref(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_SLIDE_SIZE_PREF;
  }
}

export function saveSlideSizePref(pref: SlideSizePref): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pref));
  } catch {
    // storage unavailable — the preference just isn't remembered
  }
}
