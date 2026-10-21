import type { ScriptureVerse } from "./types";

export interface SlideBudget {
  maxChars: number;
  /** Optional cap on entries (verses or verse portions) per slide. Off when omitted. */
  maxLines?: number;
}

export const DEFAULT_SLIDE_BUDGET: SlideBudget = { maxChars: 240 };

export type SlideSizePreset = "short" | "medium" | "long";

export const SLIDE_SIZE_PRESETS: Record<SlideSizePreset, SlideBudget> = {
  short: { maxChars: 120 },
  medium: DEFAULT_SLIDE_BUDGET,
  long: { maxChars: 360 },
};

export interface AutoSlide {
  id: string;
  verses: ScriptureVerse[];
}

/**
 * Break text into pieces of at most maxChars. Prefer cutting after clause
 * punctuation in the second half of the window (so fragments aren't tiny),
 * else at the last space. A run with no spaces is left whole.
 */
export function splitLongText(text: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let rest = text.trim();
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars + 1);
    let cut = -1;
    const punct = /[.;:,?!]["'”’)]?(?=\s)/g;
    let m: RegExpExecArray | null;
    while ((m = punct.exec(window))) {
      const end = m.index + m[0].length;
      if (end <= maxChars && end >= maxChars / 2) cut = end;
    }
    if (cut < 0) cut = window.lastIndexOf(" ");
    if (cut <= 0) break;
    pieces.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/**
 * Greedy fill by characters, whole verses preferred. A verse longer than
 * maxChars is split with splitLongText; consecutive fragments of one verse
 * always land on separate slides.
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
    const pieces = v.text.length > budget.maxChars ? splitLongText(v.text, budget.maxChars) : [v.text];
    pieces.forEach((text, pieceIdx) => {
      const wouldExceedChars = currentChars + text.length > budget.maxChars;
      const wouldExceedLines = budget.maxLines !== undefined && current.length + 1 > budget.maxLines;
      if (current.length > 0 && (pieceIdx > 0 || wouldExceedChars || wouldExceedLines)) {
        flush();
      }
      current.push({ ...v, text });
      currentChars += text.length;
    });
  }
  flush();
  return slides;
}
/** One whitespace-delimited word of a passage, tagged with its source verse. */
export interface PassageWord {
  verseIdx: number;
  text: string;
}

/**
 * Editor model: the full passage as words, plus the word indexes where a new
 * slide starts. Index 0 and indexes >= words.length are never breaks.
 */
export interface BreakModel {
  verses: ScriptureVerse[];
  words: PassageWord[];
  breaks: Set<number>;
}

export function tokenize(verses: ScriptureVerse[]): PassageWord[] {
  const words: PassageWord[] = [];
  verses.forEach((v, verseIdx) => {
    for (const text of v.text.split(/\s+/)) {
      if (text) words.push({ verseIdx, text });
    }
  });
  return words;
}

/**
 * Regroup words into slides. A verse whose words straddle a break becomes a
 * portion on each slide (same book/chapter/verse, partial text).
 */
export function breaksToSlides(
  verses: ScriptureVerse[],
  words: PassageWord[],
  breaks: ReadonlySet<number>,
): AutoSlide[] {
  const slides: AutoSlide[] = [];
  let current: ScriptureVerse[] = [];
  let currentVerseIdx = -1;
  let slideIdx = 0;

  const flush = () => {
    if (current.length === 0) return;
    slides.push({ id: nextId(slideIdx++), verses: current });
    current = [];
    currentVerseIdx = -1;
  };

  words.forEach((w, i) => {
    if (i > 0 && breaks.has(i)) flush();
    if (w.verseIdx === currentVerseIdx) {
      const last = current[current.length - 1]!;
      current[current.length - 1] = { ...last, text: `${last.text} ${w.text}` };
    } else {
      const src = verses[w.verseIdx]!;
      current.push({ book: src.book, chapter: src.chapter, verse: src.verse, text: w.text });
      currentVerseIdx = w.verseIdx;
    }
  });
  flush();
  return slides;
}

/**
 * Inverse of breaksToSlides: merge verse portions back into whole verses and
 * record where each slide (after the first) starts, as a word index.
 */
export function slidesToBreaks(
  slides: ReadonlyArray<{ verses: ScriptureVerse[] }>,
): BreakModel {
  const merged: ScriptureVerse[] = [];
  const breaks = new Set<number>();
  let wordCount = 0;

  slides.forEach((slide, slideIdx) => {
    if (slideIdx > 0) breaks.add(wordCount);
    slide.verses.forEach((v, entryIdx) => {
      const text = v.text.trim();
      const last = merged[merged.length - 1];
      const continues =
        entryIdx === 0 &&
        last !== undefined &&
        last.book === v.book &&
        last.chapter === v.chapter &&
        last.verse === v.verse;
      if (continues) {
        if (text) last.text = last.text ? `${last.text} ${text}` : text;
      } else {
        merged.push({ book: v.book, chapter: v.chapter, verse: v.verse, text });
      }
      wordCount += text ? text.split(/\s+/).length : 0;
    });
  });

  // Whitespace-only verses contribute no words, so dropping them leaves every
  // break's word index valid.
  const nonEmpty = merged.filter((v) => v.text.length > 0);
  const words = tokenize(nonEmpty);
  for (const b of [...breaks]) {
    if (b <= 0 || b >= words.length) breaks.delete(b);
  }
  return { verses: nonEmpty, words, breaks };
}

function nextId(idx: number): string {
  // Stable, plan-friendly ids. The operator-edited shape will replace these
  // with persisted slide ids on save (see ScriptureRowModal).
  return `slide-${idx}`;
}
