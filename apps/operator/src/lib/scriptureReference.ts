import type { ScriptureSlide } from "@overlaysys/core";
import { BOOKS } from "@overlaysys/scripture";

type VerseRef = { book: string; chapter: number; verse: number };

const verseKey = (v: VerseRef) => `${v.book}:${v.chapter}:${v.verse}`;

function countVerses(slides: ScriptureSlide[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const s of slides) {
    for (const v of s.verses) counts.set(verseKey(v), (counts.get(verseKey(v)) ?? 0) + 1);
  }
  return counts;
}

/**
 * Human-readable reference for one slide of a row, e.g. "John 3:16b-17".
 * A verse that appears on more than one slide (split mid-verse) gets a
 * letter suffix by order of appearance: a, b, c…
 */
export function slideReference(slides: ScriptureSlide[], slideIdx: number): string {
  const slide = slides[slideIdx];
  if (!slide || slide.verses.length === 0) return "";

  const total = countVerses(slides);
  const before = countVerses(slides.slice(0, slideIdx));
  const suffix = (v: VerseRef) => {
    const k = verseKey(v);
    return (total.get(k) ?? 0) > 1 ? String.fromCharCode(97 + (before.get(k) ?? 0)) : "";
  };

  const first = slide.verses[0]!;
  const bookName = BOOKS.find((b) => b.id === first.book)?.name ?? first.book;

  // Group verses into contiguous runs. A run breaks when the next verse is not
  // exactly prev.verse + 1 within the same chapter, or verse 1 of the next
  // chapter (cross-chapter run like 3:36 → 4:1).
  type Run = {
    startChapter: number;
    startVerse: number;
    startSuffix: string;
    endChapter: number;
    endVerse: number;
    endSuffix: string;
  };
  const runs: Run[] = [];

  for (const v of slide.verses) {
    const last = runs[runs.length - 1];
    const isContiguous =
      last &&
      ((v.chapter === last.endChapter && v.verse === last.endVerse + 1) ||
        (v.chapter === last.endChapter + 1 && v.verse === 1));
    if (isContiguous && last) {
      last.endChapter = v.chapter;
      last.endVerse = v.verse;
      last.endSuffix = suffix(v);
    } else {
      const sfx = suffix(v);
      runs.push({
        startChapter: v.chapter,
        startVerse: v.verse,
        startSuffix: sfx,
        endChapter: v.chapter,
        endVerse: v.verse,
        endSuffix: sfx,
      });
    }
  }

  const runStrings = runs.map((r) => {
    const start = `${r.startChapter}:${r.startVerse}${r.startSuffix}`;
    if (r.startChapter === r.endChapter && r.startVerse === r.endVerse) return start;
    if (r.startChapter === r.endChapter) return `${start}-${r.endVerse}${r.endSuffix}`;
    return `${start}-${r.endChapter}:${r.endVerse}${r.endSuffix}`;
  });

  return `${bookName} ${runStrings.join(", ")}`;
}
