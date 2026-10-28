import type { PassageWord, SlideBudget } from "@overlaysys/scripture";

// Pure operations behind ScriptureSlideEditor. A break is the word index
// where a new slide starts; 0 and >= wordCount are never valid, so no
// operation here can produce an empty slide.

const valid = (at: number, wordCount: number) => at > 0 && at < wordCount;

export function addBreak(breaks: ReadonlySet<number>, at: number, wordCount: number): Set<number> {
  const next = new Set(breaks);
  if (valid(at, wordCount)) next.add(at);
  return next;
}

export function removeBreak(breaks: ReadonlySet<number>, at: number): Set<number> {
  const next = new Set(breaks);
  next.delete(at);
  return next;
}

export function moveBreak(
  breaks: ReadonlySet<number>,
  from: number,
  to: number,
  wordCount: number,
): Set<number> {
  const next = new Set(breaks);
  if (!breaks.has(from) || breaks.has(to) || !valid(to, wordCount)) return next;
  next.delete(from);
  next.add(to);
  return next;
}

export function isVerseBoundary(words: PassageWord[], i: number): boolean {
  return i > 0 && i < words.length && words[i]!.verseIdx !== words[i - 1]!.verseIdx;
}

/** Where a break at `at` would go when nudged; null when there is nowhere to go. */
export function nudgeTarget(
  words: PassageWord[],
  at: number,
  dir: -1 | 1,
  unit: "word" | "verse",
): number | null {
  if (unit === "word") {
    const t = at + dir;
    return valid(t, words.length) ? t : null;
  }
  for (let i = at + dir; valid(i, words.length); i += dir) {
    if (isVerseBoundary(words, i)) return i;
  }
  return null;
}

export function slideStarts(breaks: ReadonlySet<number>): number[] {
  return [0, ...[...breaks].sort((a, b) => a - b)];
}

export function slideCharCounts(words: PassageWord[], breaks: ReadonlySet<number>): number[] {
  const starts = slideStarts(breaks);
  return starts.map((start, i) => {
    const end = starts[i + 1] ?? words.length;
    const slice = words.slice(start, end);
    return slice.reduce((n, w) => n + w.text.length, 0) + Math.max(0, slice.length - 1);
  });
}

/** Keep a slide's id when its first word is unchanged; otherwise mint a fresh `slide-N`. */
export function stableSlideIds(prevIds: string[], prevStarts: number[], nextStarts: number[]): string[] {
  const byStart = new Map<number, string>();
  prevStarts.forEach((s, i) => {
    const id = prevIds[i];
    if (id !== undefined) byStart.set(s, id);
  });
  const used = new Set<string>();
  const kept = nextStarts.map((s) => {
    const id = byStart.get(s);
    if (id === undefined || used.has(id)) return undefined;
    used.add(id);
    return id;
  });
  const taken = new Set([...prevIds, ...used]);
  let n = 0;
  return kept.map((id) => {
    if (id !== undefined) return id;
    while (taken.has(`slide-${n}`)) n++;
    const fresh = `slide-${n}`;
    taken.add(fresh);
    return fresh;
  });
}

// ── Lyric slides ─────────────────────────────────────────────────────────────
// Song slides are typed by hand rather than split from a passage, so the
// song editor only reports against a budget instead of re-splitting. Same
// SlideBudget shape as scripture; maxLines here counts typed lines.

/** Default budget for a lyric slide: what reads comfortably on a lower third. */
export const LYRIC_SLIDE_BUDGET: SlideBudget = { maxChars: 160, maxLines: 4 };

export interface LyricSlideStats {
  /** Characters across all lines, counting each line break as one space. */
  chars: number;
  /** Typed lines; trailing empty lines (a stray Enter) aren't counted. */
  lines: number;
  overChars: boolean;
  overLines: boolean;
}

export function lyricSlideStats(
  lines: readonly string[],
  budget: SlideBudget = LYRIC_SLIDE_BUDGET,
): LyricSlideStats {
  const kept = lines.slice();
  while (kept.length > 0 && kept[kept.length - 1]!.trim() === "") kept.pop();
  const chars = kept.reduce((n, l) => n + l.trim().length, 0) + Math.max(0, kept.length - 1);
  return {
    chars,
    lines: kept.length,
    overChars: chars > budget.maxChars,
    overLines: budget.maxLines !== undefined && kept.length > budget.maxLines,
  };
}
