import type { ScriptureVerse } from "./types";

export interface SlideBudget {
  maxChars: number;
  maxLines: number;
}

export const DEFAULT_SLIDE_BUDGET: SlideBudget = { maxChars: 240, maxLines: 4 };

export interface AutoSlide {
  id: string;
  verses: ScriptureVerse[];
}

/**
 * Greedy fill: append verses to the current slide until adding one would
 * exceed either budget. A single verse longer than the budget gets its own
 * slide (verse boundaries are preserved in v1 — never split mid-verse).
 *
 * Each verse counts as one line for line-budget purposes. Char count is
 * the sum of verse texts on the slide (separators ignored).
 */
export function splitIntoSlides(
  verses: ScriptureVerse[],
  budget: SlideBudget,
): AutoSlide[] {
  if (verses.length === 0) return [];

  const slides: AutoSlide[] = [];
  let current: ScriptureVerse[] = [];
  let currentChars = 0;
  let slideIdx = 0;

  const flush = () => {
    if (current.length === 0) return;
    slides.push({ id: nextId(slideIdx++), verses: current });
    current = [];
    currentChars = 0;
  };

  for (const v of verses) {
    const wouldExceedChars = currentChars + v.text.length > budget.maxChars;
    const wouldExceedLines = current.length + 1 > budget.maxLines;
    if (current.length > 0 && (wouldExceedChars || wouldExceedLines)) {
      flush();
    }
    current.push(v);
    currentChars += v.text.length;
  }
  flush();
  return slides;
}

function nextId(idx: number): string {
  // Stable, plan-friendly ids. The operator-edited shape will replace these
  // with persisted slide ids on save (see ScriptureRowModal).
  return `slide-${idx}`;
}
