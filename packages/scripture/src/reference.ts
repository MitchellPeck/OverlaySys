import { findBookByAlias } from "./books";
import { ScriptureRefError, type ParsedReference, type RefRange } from "./types";

/**
 * Parses an operator-typed scripture reference string into a normalized list
 * of references, one entry per book mentioned. Pure: validates syntax and
 * book aliases only. Per-book chapter/verse existence is the provider's job
 * (the parser has no per-book chapter counts in its execution path).
 *
 * Accepted shapes:
 *   - "John 3:16"
 *   - "John 3:16-18"
 *   - "John 3:16-4:2"   (cross-chapter)
 *   - "Rom 8:28; 1 Cor 13:4-7"  (multi-passage; semicolons)
 */
export function parseReference(input: string): ParsedReference[] {
  if (!input || !input.trim()) {
    throw new ScriptureRefError("Reference is empty");
  }
  const segments = input
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (segments.length === 0) {
    throw new ScriptureRefError("Reference is empty");
  }
  return segments.map((segment) => parseSegment(segment));
}

function parseSegment(segment: string): ParsedReference {
  // Match: <book> <chapter>:<verse>[-(<chapter>:)?<verse>]
  // The book portion is greedy up to the last whitespace before a digit.
  const match = segment.match(
    /^\s*(.+?)\s+(\d+)\s*:\s*(\d+)(?:\s*-\s*(?:(\d+)\s*:\s*)?(\d+))?\s*$/,
  );
  if (!match) {
    throw new ScriptureRefError(
      `Could not parse "${segment}". Expected "Book Chapter:Verse" or "Book Chapter:Verse-Verse".`,
    );
  }
  const [, bookText, chStr, vStr, endChStr, endVStr] = match;
  const book = findBookByAlias(bookText!);
  if (!book) {
    throw new ScriptureRefError(`Unknown book "${bookText!.trim()}"`);
  }
  const chapter = Number(chStr);
  const startVerse = Number(vStr);
  if (chapter <= 0 || startVerse <= 0) {
    throw new ScriptureRefError(
      `Chapter and verse must be positive in "${segment}"`,
    );
  }
  let endChapter = chapter;
  let endVerse = startVerse;
  if (endVStr !== undefined) {
    endVerse = Number(endVStr);
    if (endChStr !== undefined) endChapter = Number(endChStr);
    if (endChapter <= 0 || endVerse <= 0) {
      throw new ScriptureRefError(
        `End chapter/verse must be positive in "${segment}"`,
      );
    }
    if (
      endChapter < chapter ||
      (endChapter === chapter && endVerse < startVerse)
    ) {
      throw new ScriptureRefError(
        `Range end precedes start in "${segment}"`,
      );
    }
  }
  const range: RefRange = { chapter, startVerse, endChapter, endVerse };
  return { book: book.id, ranges: [range] };
}

/**
 * Guess a scripture reference from a free-text title (e.g. a Planning Center
 * plan item title). Tries the whole title, then the text after the last ":" or
 * " - " / " – " / " — " separator when the prefix contains no digits (so
 * "Announcements: Week 3" and "Scripture: John 3:16" are told apart by what
 * parses). Returns the first candidate `parseReference` accepts, else null.
 */
export function guessScriptureReference(title: string): string | null {
  const whole = title.trim();
  if (!whole) return null;
  const candidates: string[] = [whole];
  const sep = /\s+[-–—]\s+|:\s*/g;
  let lastEnd = -1;
  let lastStart = -1;
  for (let m = sep.exec(whole); m; m = sep.exec(whole)) {
    const prefix = whole.slice(0, m.index);
    // A colon inside "John 3:16" has digits before it; labels don't.
    if (/\d/.test(prefix)) continue;
    lastStart = m.index;
    lastEnd = m.index + m[0].length;
  }
  if (lastStart >= 0) candidates.push(whole.slice(lastEnd).trim());
  for (const c of candidates) {
    if (!c) continue;
    try {
      parseReference(c);
      return c;
    } catch {
      // try next candidate
    }
  }
  return null;
}
