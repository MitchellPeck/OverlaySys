# Scripture Slide Splitting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let operators choose how much scripture text lands on each slide at import, and shift text between slides by adding/removing/dragging slide-break markers anywhere between two words (including mid-verse).

**Architecture:** No schema change — a partial verse is the same `{book, chapter, verse}` appearing on consecutive slides with a portion of the text each. `@overlaysys/scripture` gains a word/break model (`tokenize`, `breaksToSlides`, `slidesToBreaks`) and a mid-verse-capable auto-splitter with size presets. The operator editor becomes one continuous text block with break markers; its logic lives in pure modules under `apps/operator/src/lib/` so it is unit-testable in the Node vitest environment.

**Tech Stack:** TypeScript, React 19 / Next 15 (operator), vitest (root `vitest.config.ts`, `environment: "node"`, no DOM), `@overlaysys/ui` components + `colors` tokens, `lucide-react` icons.

**Spec:** `docs/superpowers/specs/2026-10-21-scripture-slide-splitting-design.md`

## Global Constraints

- No change to `ScriptureSlideSchema` / `ScriptureRowSchema` in `packages/core/src/show.ts`.
- Presets: short = 120, medium = 240 (== `DEFAULT_SLIDE_BUDGET.maxChars`), long = 360 chars. Custom clamped to 40–2000.
- `SlideBudget.maxLines` becomes optional; `DEFAULT_SLIDE_BUDGET` omits it (verse-count limit off by default).
- Slide-size preference stored in `localStorage`; every access wrapped in try/catch; falls back to `medium`.
- Re-split confirm copy, verbatim: `Re-split and discard your manual breaks?`
- Reference label separator stays `-` (matches existing `ScriptureTakeStrip` output), partial-verse suffixes are lowercase letters `a`, `b`, `c`… by order of appearance.
- Deviation from spec, by necessity: the operator app has no DOM test environment, so "component tests" are written against the pure modules the components call (`slideBreaks.ts`, `scriptureReference.ts`, `slideSizePref.ts`). The components themselves are verified by `pnpm -w typecheck` and a manual run.
- `main` has many unrelated uncommitted changes. Every commit step stages **only the files named in that task** (`git add <paths>`), never `git add -A` / `git add .`.
- Run tests from repo root: `pnpm vitest run <path>`.

## Review Focus

1. **Editing a saved row that already has partial verses** — the modal's synthesized passage must merge fragments, not list verse 16 twice. Pinned in Task 1 (`slidesToBreaks` merges) and Task 6 (modal uses it).
2. **Verse text with newlines / double spaces** — must tokenize cleanly, not produce empty words or empty slides. Pinned in Task 1.
3. **A long verse whose only punctuation is very early** — must not produce a tiny first fragment, and two fragments of one verse must never share a slide. Pinned in Task 2.
4. **Old rows with only whole-verse slides** — reference labels must be byte-identical to today's. Pinned in Task 3.
5. **Garbage custom size (empty, NaN, 0, 99999) or throwing localStorage** — must fall back/clamp, never crash or produce a 0-char budget. Pinned in Task 5.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/scripture/src/slideSplit.ts` (modify) | Budget types, presets, word/break model, auto-split incl. mid-verse |
| `packages/scripture/src/slideSplit.test.ts` (modify) | Tests for the above |
| `apps/operator/src/lib/scriptureReference.ts` (create) | Per-slide reference label with `a/b` suffixes |
| `apps/operator/src/lib/scriptureReference.test.ts` (create) | Label tests |
| `apps/operator/src/lib/slideBreaks.ts` (create) | Pure editor ops: add/remove/move/nudge breaks, char counts, stable ids |
| `apps/operator/src/lib/slideBreaks.test.ts` (create) | Editor-op tests |
| `apps/operator/src/lib/slideSizePref.ts` (create) | Size preference parse/clamp/budget + guarded localStorage load/save |
| `apps/operator/src/lib/slideSizePref.test.ts` (create) | Pref tests |
| `apps/operator/src/app/components/ScriptureTakeStrip.tsx` (modify) | Use `slideReference` |
| `apps/operator/src/app/components/ScriptureSlideEditor.tsx` (rewrite) | Continuous-text break-marker editor |
| `apps/operator/src/app/components/ScriptureRowModal.tsx` (modify) | Size selector, re-split confirm, fragment-safe passage rebuild |

---

### Task 1: Word/break model in `@overlaysys/scripture`

**Files:**
- Modify: `packages/scripture/src/slideSplit.ts`
- Test: `packages/scripture/src/slideSplit.test.ts`

**Interfaces:**
- Consumes: `ScriptureVerse` from `./types`; existing `AutoSlide`, `nextId`.
- Produces:
  ```ts
  export interface PassageWord { verseIdx: number; text: string }
  export interface BreakModel { verses: ScriptureVerse[]; words: PassageWord[]; breaks: Set<number> }
  export function tokenize(verses: ScriptureVerse[]): PassageWord[]
  export function breaksToSlides(verses: ScriptureVerse[], words: PassageWord[], breaks: ReadonlySet<number>): AutoSlide[]
  export function slidesToBreaks(slides: ReadonlyArray<{ verses: ScriptureVerse[] }>): BreakModel
  ```

- [ ] **Step 1: Write the failing tests** — append to `slideSplit.test.ts` (update the import line to `import { splitIntoSlides, DEFAULT_SLIDE_BUDGET, tokenize, breaksToSlides, slidesToBreaks } from "./slideSplit";`):

```ts
describe("word/break model", () => {
  const verses = [
    V("JHN", 3, 16, "For God so loved the world"),
    V("JHN", 3, 17, "For God sent not his Son"),
  ];

  it("tokenize tags each word with its verse index and drops empty words", () => {
    const words = tokenize([V("JHN", 3, 16, "  a\n b  "), V("JHN", 3, 17, "c")]);
    expect(words).toEqual([
      { verseIdx: 0, text: "a" },
      { verseIdx: 0, text: "b" },
      { verseIdx: 1, text: "c" },
    ]);
  });

  it("breaksToSlides with no breaks yields one slide of whole verses", () => {
    const words = tokenize(verses);
    const slides = breaksToSlides(verses, words, new Set());
    expect(slides).toHaveLength(1);
    expect(slides[0]!.verses).toEqual(verses);
  });

  it("breaksToSlides splits mid-verse into two portions of the same verse", () => {
    const words = tokenize(verses);
    const slides = breaksToSlides(verses, words, new Set([3])); // after "For God so"
    expect(slides).toHaveLength(2);
    expect(slides[0]!.verses).toEqual([V("JHN", 3, 16, "For God so")]);
    expect(slides[1]!.verses).toEqual([
      V("JHN", 3, 16, "loved the world"),
      V("JHN", 3, 17, "For God sent not his Son"),
    ]);
  });

  it("breaksToSlides ignores out-of-range breaks and never emits empty slides", () => {
    const words = tokenize(verses);
    const slides = breaksToSlides(verses, words, new Set([0, words.length, 99]));
    expect(slides).toHaveLength(1);
  });

  it("slidesToBreaks merges portions of a verse back into one verse", () => {
    const model = slidesToBreaks([
      { verses: [V("JHN", 3, 16, "For God so")] },
      { verses: [V("JHN", 3, 16, "loved the world"), V("JHN", 3, 17, "For God sent not his Son")] },
    ]);
    expect(model.verses).toEqual(verses);
    expect([...model.breaks]).toEqual([3]);
  });

  it("round-trips slides → breaks → slides", () => {
    const original = [
      { verses: [V("JHN", 3, 16, "For God so")] },
      { verses: [V("JHN", 3, 16, "loved the world")] },
      { verses: [V("JHN", 3, 17, "For God sent not his Son")] },
    ];
    const m = slidesToBreaks(original);
    const back = breaksToSlides(m.verses, m.words, m.breaks);
    expect(back.map((s) => s.verses)).toEqual(original.map((s) => s.verses));
  });

  it("slidesToBreaks collapses whitespace-only entries without creating empty slides", () => {
    const m = slidesToBreaks([
      { verses: [V("JHN", 3, 16, "a b")] },
      { verses: [V("JHN", 3, 17, "   ")] },
      { verses: [V("JHN", 3, 18, "c")] },
    ]);
    const back = breaksToSlides(m.verses, m.words, m.breaks);
    expect(back.every((s) => s.verses.length > 0)).toBe(true);
    expect(back.flatMap((s) => s.verses.map((v) => v.text))).toEqual(["a b", "c"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/scripture/src/slideSplit.test.ts`
Expected: FAIL — `tokenize is not a function` (or TS import error).

- [ ] **Step 3: Implement** — add to `slideSplit.ts` (above `nextId`):

```ts
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
        last.text = text ? (last.text ? `${last.text} ${text}` : text) : last.text;
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
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run packages/scripture/src/slideSplit.test.ts`
Expected: all PASS (including the pre-existing `splitIntoSlides` tests).

- [ ] **Step 5: Commit**

```bash
git add packages/scripture/src/slideSplit.ts packages/scripture/src/slideSplit.test.ts
git commit -m "feat(scripture): word/break model for slide editing"
```

---

### Task 2: Mid-verse auto-split and size presets

**Files:**
- Modify: `packages/scripture/src/slideSplit.ts`
- Test: `packages/scripture/src/slideSplit.test.ts`

**Interfaces:**
- Consumes: Task 1 types.
- Produces:
  ```ts
  export interface SlideBudget { maxChars: number; maxLines?: number }
  export const DEFAULT_SLIDE_BUDGET: SlideBudget            // { maxChars: 240 }
  export type SlideSizePreset = "short" | "medium" | "long"
  export const SLIDE_SIZE_PRESETS: Record<SlideSizePreset, SlideBudget>
  export function splitLongText(text: string, maxChars: number): string[]
  export function splitIntoSlides(verses: ScriptureVerse[], budget: SlideBudget): AutoSlide[]   // signature unchanged
  ```

- [ ] **Step 1: Write the failing tests** — append (extend the import with `splitLongText, SLIDE_SIZE_PRESETS`):

```ts
describe("splitLongText", () => {
  it("cuts at the last clause punctuation within the budget", () => {
    const text = "aaaa aaaa aaaa, bbbb bbbb; cccc cccc cccc cccc";
    expect(splitLongText(text, 26)).toEqual(["aaaa aaaa aaaa, bbbb bbbb;", "cccc cccc cccc cccc"]);
  });

  it("falls back to the last space when there is no usable punctuation", () => {
    expect(splitLongText("aaa bbb ccc ddd", 8)).toEqual(["aaa bbb", "ccc ddd"]);
  });

  it("ignores punctuation in the first half of the window (no tiny fragments)", () => {
    // comma at index 1 is < maxChars/2, so cut at the last space instead
    expect(splitLongText("a, bbbbbb cccccc dddddd", 16)).toEqual(["a, bbbbbb cccccc", "dddddd"]);
  });

  it("keeps a word with no spaces whole", () => {
    const long = "x".repeat(50);
    expect(splitLongText(long, 10)).toEqual([long]);
  });

  it("returns the text unchanged when it fits", () => {
    expect(splitLongText("short", 100)).toEqual(["short"]);
  });
});

describe("splitIntoSlides (mid-verse)", () => {
  it("splits an overlong verse across slides", () => {
    const text = "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish.";
    const slides = splitIntoSlides([V("JHN", 3, 16, text)], { maxChars: 60 });
    expect(slides.length).toBeGreaterThan(1);
    for (const s of slides) {
      expect(s.verses).toHaveLength(1);
      expect(s.verses[0]!.verse).toBe(16);
      expect(s.verses[0]!.text.length).toBeLessThanOrEqual(60);
    }
    expect(slides.map((s) => s.verses[0]!.text).join(" ")).toBe(text);
  });

  it("never puts two fragments of the same verse on one slide", () => {
    // early comma forces a space-cut; remaining fragments are short enough to pack together
    const text = "a, " + "bbbbbbbbb ".repeat(4) + "c, d";
    const slides = splitIntoSlides([V("JHN", 3, 16, text)], { maxChars: 20 });
    for (const s of slides) {
      const keys = s.verses.map((v) => `${v.chapter}:${v.verse}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("has no verse-count limit when maxLines is omitted", () => {
    const verses = Array.from({ length: 8 }, (_, i) => V("JHN", 3, 16 + i, "a"));
    expect(splitIntoSlides(verses, { maxChars: 1000 })).toHaveLength(1);
  });

  it("presets produce more slides for smaller sizes", () => {
    // 63 chars each → short: 1/slide (8), medium: 3/slide (3), long: 5/slide (2)
    const verses = Array.from({ length: 8 }, (_, i) =>
      V("JHN", 3, 16 + i, "For God so loved the world, that he gave his only begotten Son."),
    );
    const n = (p: keyof typeof SLIDE_SIZE_PRESETS) => splitIntoSlides(verses, SLIDE_SIZE_PRESETS[p]).length;
    expect(n("short")).toBeGreaterThan(n("medium"));
    expect(n("medium")).toBeGreaterThan(n("long"));
    expect(SLIDE_SIZE_PRESETS.medium).toEqual(DEFAULT_SLIDE_BUDGET);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/scripture/src/slideSplit.test.ts`
Expected: FAIL — `splitLongText is not a function`.

- [ ] **Step 3: Implement** — in `slideSplit.ts` replace `SlideBudget`, `DEFAULT_SLIDE_BUDGET` and `splitIntoSlides` (and its doc comment) with:

```ts
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
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run packages/scripture/src/slideSplit.test.ts`
Expected: all PASS. The pre-existing "single overlong verse … rather than splitting it" test still passes because `"x".repeat(1000)` has no spaces.

- [ ] **Step 5: Typecheck consumers**

Run: `pnpm -w typecheck`
Expected: no new errors (only `maxLines` became optional).

- [ ] **Step 6: Commit**

```bash
git add packages/scripture/src/slideSplit.ts packages/scripture/src/slideSplit.test.ts
git commit -m "feat(scripture): mid-verse auto-split and slide size presets"
```

---

### Task 3: Reference labels with partial-verse suffixes

**Files:**
- Create: `apps/operator/src/lib/scriptureReference.ts`
- Test: `apps/operator/src/lib/scriptureReference.test.ts`
- Modify: `apps/operator/src/app/components/ScriptureTakeStrip.tsx`

**Interfaces:**
- Consumes: `ScriptureSlide` from `@overlaysys/core`, `BOOKS` from `@overlaysys/scripture`.
- Produces: `export function slideReference(slides: ScriptureSlide[], slideIdx: number): string`

- [ ] **Step 1: Write the failing tests** — `apps/operator/src/lib/scriptureReference.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ScriptureSlide } from "@overlaysys/core";
import { slideReference } from "./scriptureReference";

const v = (chapter: number, verse: number, text = "t") => ({ book: "JHN", chapter, verse, text });
const s = (...verses: ReturnType<typeof v>[]): ScriptureSlide => ({ id: Math.random().toString(), verses });

describe("slideReference", () => {
  it("whole-verse slides are unchanged from the old format", () => {
    const slides = [s(v(3, 16), v(3, 17)), s(v(3, 18))];
    expect(slideReference(slides, 0)).toBe("John 3:16-17");
    expect(slideReference(slides, 1)).toBe("John 3:18");
  });

  it("non-contiguous verses on one slide are comma-joined", () => {
    expect(slideReference([s(v(3, 16), v(3, 18))], 0)).toBe("John 3:16, 3:18");
  });

  it("suffixes portions of a split verse a, b by order", () => {
    const slides = [s(v(3, 16)), s(v(3, 16), v(3, 17))];
    expect(slideReference(slides, 0)).toBe("John 3:16a");
    expect(slideReference(slides, 1)).toBe("John 3:16b-17");
  });

  it("verse split three ways gets a, b, c", () => {
    const slides = [s(v(3, 16)), s(v(3, 16)), s(v(3, 16))];
    expect([0, 1, 2].map((i) => slideReference(slides, i))).toEqual(["John 3:16a", "John 3:16b", "John 3:16c"]);
  });

  it("cross-chapter run with a suffixed start", () => {
    const slides = [s(v(3, 36)), s(v(3, 36), v(4, 1), v(4, 2))];
    expect(slideReference(slides, 1)).toBe("John 3:36b-4:2");
  });

  it("suffixed end of a run", () => {
    const slides = [s(v(3, 20), v(3, 21)), s(v(3, 21))];
    expect(slideReference(slides, 0)).toBe("John 3:20-21a");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run apps/operator/src/lib/scriptureReference.test.ts`
Expected: FAIL — cannot resolve `./scriptureReference`.

- [ ] **Step 3: Implement** — `apps/operator/src/lib/scriptureReference.ts` (logic moved from `ScriptureTakeStrip.prettyReferenceForSlide`, plus suffixes):

```ts
import type { ScriptureSlide } from "@overlaysys/core";
import { BOOKS } from "@overlaysys/scripture";

const verseKey = (v: { book: string; chapter: number; verse: number }) =>
  `${v.book}:${v.chapter}:${v.verse}`;

/**
 * Human-readable reference for one slide of a row, e.g. "John 3:16b-17".
 * A verse that appears on more than one slide (split mid-verse) gets a
 * letter suffix by order of appearance: a, b, c…
 */
export function slideReference(slides: ScriptureSlide[], slideIdx: number): string {
  const slide = slides[slideIdx];
  if (!slide || slide.verses.length === 0) return "";

  const total = new Map<string, number>();
  for (const s of slides) for (const v of s.verses) total.set(verseKey(v), (total.get(verseKey(v)) ?? 0) + 1);
  const before = new Map<string, number>();
  for (const s of slides.slice(0, slideIdx)) for (const v of s.verses) before.set(verseKey(v), (before.get(verseKey(v)) ?? 0) + 1);

  const suffix = (v: { book: string; chapter: number; verse: number }) => {
    const k = verseKey(v);
    return (total.get(k) ?? 0) > 1 ? String.fromCharCode(97 + (before.get(k) ?? 0)) : "";
  };

  const first = slide.verses[0]!;
  const bookName = BOOKS.find((b) => b.id === first.book)?.name ?? first.book;

  // Group verses into contiguous runs: next verse in the same chapter, or
  // verse 1 of the next chapter (cross-chapter run like 3:36 → 4:1).
  type Run = {
    startChapter: number; startVerse: number; startSuffix: string;
    endChapter: number; endVerse: number; endSuffix: string;
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
        startChapter: v.chapter, startVerse: v.verse, startSuffix: sfx,
        endChapter: v.chapter, endVerse: v.verse, endSuffix: sfx,
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
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run apps/operator/src/lib/scriptureReference.test.ts`
Expected: all PASS.

- [ ] **Step 5: Wire into `ScriptureTakeStrip.tsx`**
  - Delete the local `prettyReferenceForSlide` function and the now-unused `BOOKS` and `ScriptureSlide` imports.
  - Add `import { slideReference } from "@/lib/scriptureReference";`
  - Change `function take(slide: ScriptureSlide)` to `function take(slideIdx: number)` with `const slide = row.slides[slideIdx]!;` and `reference: slideReference(row.slides, slideIdx),`.
  - In the map: `onClick={() => take(i)}` and label `{i + 1}. {slideReference(row.slides, i)}`.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @overlaysys/operator typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/operator/src/lib/scriptureReference.ts apps/operator/src/lib/scriptureReference.test.ts apps/operator/src/app/components/ScriptureTakeStrip.tsx
git commit -m "feat(operator): a/b suffixes on scripture slide references"
```

---

### Task 4: Pure break-editing operations

**Files:**
- Create: `apps/operator/src/lib/slideBreaks.ts`
- Test: `apps/operator/src/lib/slideBreaks.test.ts`

**Interfaces:**
- Consumes: `PassageWord` from `@overlaysys/scripture`.
- Produces:
  ```ts
  export function addBreak(breaks: ReadonlySet<number>, at: number, wordCount: number): Set<number>
  export function removeBreak(breaks: ReadonlySet<number>, at: number): Set<number>
  export function moveBreak(breaks: ReadonlySet<number>, from: number, to: number, wordCount: number): Set<number>
  export function nudgeTarget(words: PassageWord[], at: number, dir: -1 | 1, unit: "word" | "verse"): number | null
  export function isVerseBoundary(words: PassageWord[], i: number): boolean
  export function slideStarts(breaks: ReadonlySet<number>): number[]          // [0, ...sorted breaks]
  export function slideCharCounts(words: PassageWord[], breaks: ReadonlySet<number>): number[]
  export function stableSlideIds(prevIds: string[], prevStarts: number[], nextStarts: number[]): string[]
  ```
  All functions return new Sets/arrays; inputs are never mutated. Invalid operations return an unchanged copy.

- [ ] **Step 1: Write the failing tests** — `apps/operator/src/lib/slideBreaks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  addBreak, removeBreak, moveBreak, nudgeTarget, isVerseBoundary,
  slideStarts, slideCharCounts, stableSlideIds,
} from "./slideBreaks";

// verse 0: "a b c" (words 0-2), verse 1: "d e" (words 3-4), verse 2: "f" (word 5)
const words = [
  { verseIdx: 0, text: "a" }, { verseIdx: 0, text: "b" }, { verseIdx: 0, text: "c" },
  { verseIdx: 1, text: "d" }, { verseIdx: 1, text: "e" },
  { verseIdx: 2, text: "f" },
];
const N = words.length;

describe("addBreak / removeBreak", () => {
  it("adds a break inside the passage", () => {
    expect([...addBreak(new Set(), 2, N)]).toEqual([2]);
  });
  it("rejects index 0 and >= wordCount (no empty slides)", () => {
    expect(addBreak(new Set(), 0, N).size).toBe(0);
    expect(addBreak(new Set(), N, N).size).toBe(0);
  });
  it("does not mutate input", () => {
    const b = new Set([1]);
    addBreak(b, 2, N);
    removeBreak(b, 1);
    expect([...b]).toEqual([1]);
  });
  it("removes a break", () => {
    expect(removeBreak(new Set([1, 3]), 1)).toEqual(new Set([3]));
  });
});

describe("moveBreak", () => {
  it("moves to a free gap", () => {
    expect(moveBreak(new Set([3]), 3, 1, N)).toEqual(new Set([1]));
  });
  it("refuses to land on an existing break or out of range", () => {
    expect(moveBreak(new Set([1, 3]), 3, 1, N)).toEqual(new Set([1, 3]));
    expect(moveBreak(new Set([3]), 3, 0, N)).toEqual(new Set([3]));
    expect(moveBreak(new Set([3]), 3, N, N)).toEqual(new Set([3]));
  });
});

describe("nudgeTarget", () => {
  it("moves one word", () => {
    expect(nudgeTarget(words, 3, -1, "word")).toBe(2);
    expect(nudgeTarget(words, 3, 1, "word")).toBe(4);
  });
  it("returns null at the edges", () => {
    expect(nudgeTarget(words, 1, -1, "word")).toBeNull();
    expect(nudgeTarget(words, N - 1, 1, "word")).toBeNull();
  });
  it("jumps to the previous/next verse boundary", () => {
    expect(nudgeTarget(words, 4, -1, "verse")).toBe(3);
    expect(nudgeTarget(words, 3, 1, "verse")).toBe(5);
    expect(nudgeTarget(words, 1, 1, "verse")).toBe(3);
    expect(nudgeTarget(words, 3, -1, "verse")).toBeNull();
  });
});

describe("helpers", () => {
  it("isVerseBoundary", () => {
    expect(isVerseBoundary(words, 3)).toBe(true);
    expect(isVerseBoundary(words, 2)).toBe(false);
    expect(isVerseBoundary(words, 0)).toBe(false);
  });
  it("slideStarts sorts breaks after 0", () => {
    expect(slideStarts(new Set([5, 2]))).toEqual([0, 2, 5]);
  });
  it("slideCharCounts counts word lengths plus single spaces per slide", () => {
    expect(slideCharCounts(words, new Set([3]))).toEqual([5, 5]); // "a b c" | "d e f"
  });
  it("stableSlideIds keeps ids whose start is unchanged and mints unique new ones", () => {
    const ids = stableSlideIds(["slide-0", "slide-1"], [0, 3], [0, 2, 3]);
    expect(ids[0]).toBe("slide-0");
    expect(ids[2]).toBe("slide-1");
    expect(new Set(ids).size).toBe(3);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run apps/operator/src/lib/slideBreaks.test.ts`
Expected: FAIL — cannot resolve `./slideBreaks`.

- [ ] **Step 3: Implement** — `apps/operator/src/lib/slideBreaks.ts`:

```ts
import type { PassageWord } from "@overlaysys/scripture";

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
  const ids = nextStarts.map((s) => {
    const id = byStart.get(s);
    if (id !== undefined && !used.has(id)) {
      used.add(id);
      return id;
    }
    return undefined;
  });
  const taken = new Set([...prevIds, ...used]);
  let n = 0;
  return ids.map((id) => {
    if (id !== undefined) return id;
    while (taken.has(`slide-${n}`)) n++;
    const fresh = `slide-${n}`;
    taken.add(fresh);
    return fresh;
  });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run apps/operator/src/lib/slideBreaks.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/operator/src/lib/slideBreaks.ts apps/operator/src/lib/slideBreaks.test.ts
git commit -m "feat(operator): pure slide-break editing operations"
```

---

### Task 5: Slide-size preference

**Files:**
- Create: `apps/operator/src/lib/slideSizePref.ts`
- Test: `apps/operator/src/lib/slideSizePref.test.ts`

**Interfaces:**
- Consumes: `SLIDE_SIZE_PRESETS`, `SlideBudget`, `SlideSizePreset` from `@overlaysys/scripture`.
- Produces:
  ```ts
  export type SlideSizePref = { kind: SlideSizePreset } | { kind: "custom"; maxChars: number }
  export const DEFAULT_SLIDE_SIZE_PREF: SlideSizePref         // { kind: "medium" }
  export function clampCustomChars(n: number): number          // NaN/≤0 → 240; else clamp 40..2000, rounded
  export function parseSlideSizePref(raw: string | null): SlideSizePref
  export function budgetForPref(pref: SlideSizePref): SlideBudget
  export function loadSlideSizePref(): SlideSizePref           // localStorage, guarded
  export function saveSlideSizePref(pref: SlideSizePref): void // localStorage, guarded
  ```

- [ ] **Step 1: Write the failing tests** — `apps/operator/src/lib/slideSizePref.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  budgetForPref, clampCustomChars, parseSlideSizePref, loadSlideSizePref, DEFAULT_SLIDE_SIZE_PREF,
} from "./slideSizePref";

describe("slideSizePref", () => {
  it("presets map to the scripture presets", () => {
    expect(budgetForPref({ kind: "short" })).toEqual({ maxChars: 120 });
    expect(budgetForPref({ kind: "medium" })).toEqual({ maxChars: 240 });
    expect(budgetForPref({ kind: "long" })).toEqual({ maxChars: 360 });
  });

  it("custom is clamped", () => {
    expect(budgetForPref({ kind: "custom", maxChars: 10 })).toEqual({ maxChars: 40 });
    expect(budgetForPref({ kind: "custom", maxChars: 99999 })).toEqual({ maxChars: 2000 });
    expect(clampCustomChars(Number.NaN)).toBe(240);
    expect(clampCustomChars(0)).toBe(240);
    expect(clampCustomChars(150.6)).toBe(151);
  });

  it("parse falls back to medium on garbage", () => {
    expect(parseSlideSizePref(null)).toEqual(DEFAULT_SLIDE_SIZE_PREF);
    expect(parseSlideSizePref("not json")).toEqual(DEFAULT_SLIDE_SIZE_PREF);
    expect(parseSlideSizePref('{"kind":"huge"}')).toEqual(DEFAULT_SLIDE_SIZE_PREF);
    expect(parseSlideSizePref('{"kind":"custom","maxChars":"x"}')).toEqual({ kind: "custom", maxChars: 240 });
  });

  it("parse round-trips valid prefs", () => {
    expect(parseSlideSizePref('{"kind":"long"}')).toEqual({ kind: "long" });
    expect(parseSlideSizePref('{"kind":"custom","maxChars":180}')).toEqual({ kind: "custom", maxChars: 180 });
  });

  it("load returns the default when localStorage is unavailable (node)", () => {
    expect(loadSlideSizePref()).toEqual(DEFAULT_SLIDE_SIZE_PREF);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run apps/operator/src/lib/slideSizePref.test.ts`
Expected: FAIL — cannot resolve `./slideSizePref`.

- [ ] **Step 3: Implement** — `apps/operator/src/lib/slideSizePref.ts`:

```ts
import { SLIDE_SIZE_PRESETS, type SlideBudget, type SlideSizePreset } from "@overlaysys/scripture";

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
    // fall through
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
    // storage unavailable — preference just isn't remembered
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run apps/operator/src/lib/slideSizePref.test.ts`
Expected: all PASS (in Node, `window` is undefined → the `ReferenceError` is caught → default).

- [ ] **Step 5: Commit**

```bash
git add apps/operator/src/lib/slideSizePref.ts apps/operator/src/lib/slideSizePref.test.ts
git commit -m "feat(operator): remembered scripture slide-size preference"
```

---

### Task 6: Break-marker editor + size selector in the import modal

**Files:**
- Rewrite: `apps/operator/src/app/components/ScriptureSlideEditor.tsx`
- Modify: `apps/operator/src/app/components/ScriptureRowModal.tsx` (imports; passage synthesis at ~line 66-73; `Step2` at ~line 324-380)

**Interfaces:**
- Consumes: `slidesToBreaks`, `breaksToSlides`, `splitIntoSlides`, `SlideBudget` (Tasks 1–2); everything from `@/lib/slideBreaks` (Task 4) and `@/lib/slideSizePref` (Task 5).
- Produces: `ScriptureSlideEditor` props become `{ slides: EditableSlide[]; onChange: (next: EditableSlide[]) => void; budget: SlideBudget }`. `EditableSlide` export unchanged.

- [ ] **Step 1: Rewrite `ScriptureSlideEditor.tsx`** with this content:

```tsx
"use client";

import { Fragment, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { breaksToSlides, slidesToBreaks, type ScriptureVerse, type SlideBudget } from "@overlaysys/scripture";
import { colors } from "@overlaysys/ui";
import {
  addBreak, isVerseBoundary, moveBreak, nudgeTarget, removeBreak,
  slideCharCounts, slideStarts, stableSlideIds,
} from "@/lib/slideBreaks";

export interface EditableSlide {
  id: string;
  verses: ScriptureVerse[];
}

interface Props {
  slides: EditableSlide[];
  onChange: (next: EditableSlide[]) => void;
  budget: SlideBudget;
}

/**
 * The passage as one continuous block of text. Slide breaks are markers:
 * click a gap between words to add one, ✕ to remove, drag (or ←/→, ⇧←/⇧→
 * when focused) to move.
 */
export function ScriptureSlideEditor({ slides, onChange, budget }: Props) {
  const model = useMemo(() => slidesToBreaks(slides), [slides]);
  const { verses, words, breaks } = model;
  const counts = slideCharCounts(words, breaks);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const focusAfterChange = useRef<number | null>(null);

  function commit(next: Set<number>) {
    const regrouped = breaksToSlides(verses, words, next);
    const ids = stableSlideIds(slides.map((s) => s.id), slideStarts(breaks), slideStarts(next));
    onChange(regrouped.map((s, i) => ({ id: ids[i]!, verses: s.verses })));
  }

  function onBreakKey(e: KeyboardEvent, at: number) {
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      commit(removeBreak(breaks, at));
      return;
    }
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const target = nudgeTarget(words, at, e.key === "ArrowLeft" ? -1 : 1, e.shiftKey ? "verse" : "word");
    if (target === null || breaks.has(target)) return;
    focusAfterChange.current = target;
    commit(moveBreak(breaks, at, target, words.length));
  }

  const starts = slideStarts(breaks);
  const label = (slideIdx: number) => {
    const n = counts[slideIdx] ?? 0;
    const over = n > budget.maxChars;
    return (
      <span style={{ color: over ? colors.warn : colors.textDim }}>
        Slide {slideIdx + 1} · {n} chars{over ? ` (over ${budget.maxChars})` : ""}
      </span>
    );
  };

  return (
    <div
      data-testid="slide-editor"
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        padding: 10,
        lineHeight: 1.9,
        maxHeight: 420,
        overflowY: "auto",
      }}
    >
      <div style={{ fontSize: 12 }}>{label(0)}</div>
      {words.map((w, i) => {
        const isBreak = i > 0 && breaks.has(i);
        const startsVerse = i === 0 || words[i - 1]!.verseIdx !== w.verseIdx;
        const slideIdx = starts.filter((s) => s <= i).length - 1;
        return (
          <Fragment key={i}>
            {isBreak ? (
              <div
                role="separator"
                tabIndex={0}
                draggable
                aria-label={`Break before slide ${slideIdx + 1}. Arrow keys move it, Shift moves by verse, Delete removes it.`}
                ref={(el) => {
                  if (el && focusAfterChange.current === i) {
                    focusAfterChange.current = null;
                    el.focus();
                  }
                }}
                onKeyDown={(e) => onBreakKey(e, i)}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  setDragFrom(i);
                }}
                onDragEnd={() => {
                  setDragFrom(null);
                  setDropAt(null);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  margin: "6px 0",
                  padding: "0 6px",
                  fontSize: 12,
                  borderTop: `2px solid ${colors.brand}`,
                  cursor: "grab",
                  opacity: dragFrom === i ? 0.4 : 1,
                }}
              >
                {label(slideIdx)}
                <button
                  type="button"
                  aria-label={`Remove break before slide ${slideIdx + 1}`}
                  onClick={() => commit(removeBreak(breaks, i))}
                  style={{ marginLeft: "auto", background: "none", border: 0, color: colors.textDim, cursor: "pointer" }}
                >
                  <X size={14} aria-hidden style={{ verticalAlign: "-2px" }} />
                </button>
              </div>
            ) : (
              i > 0 && (
                <Gap
                  wide={isVerseBoundary(words, i)}
                  active={dropAt === i}
                  onClick={() => commit(addBreak(breaks, i, words.length))}
                  onDragOver={(e) => {
                    if (dragFrom === null) return;
                    e.preventDefault();
                    setDropAt(i);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragFrom !== null) commit(moveBreak(breaks, dragFrom, i, words.length));
                    setDragFrom(null);
                    setDropAt(null);
                  }}
                />
              )
            )}
            {startsVerse && (
              <sup style={{ fontWeight: 700, color: colors.textDim, marginRight: 3 }}>
                {verses[w.verseIdx]!.verse}
              </sup>
            )}
            <span>{w.text}</span>
          </Fragment>
        );
      })}
    </div>
  );
}

function Gap({
  wide,
  active,
  onClick,
  onDragOver,
  onDrop,
}: {
  wide: boolean;
  active: boolean;
  onClick: () => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
}) {
  const [hover, setHover] = useState(false);
  const show = hover || active;
  return (
    <span
      role="button"
      aria-label="Insert slide break here"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{
        display: "inline-block",
        width: wide ? 14 : 8,
        height: "1.2em",
        verticalAlign: "middle",
        cursor: "pointer",
        borderLeft: show ? `2px solid ${colors.brand}` : "2px solid transparent",
        marginLeft: wide ? 3 : 2,
      }}
    />
  );
}
```

- [ ] **Step 2: Fix passage synthesis for saved rows with partial verses** — in `ScriptureRowModal.tsx` add `slidesToBreaks` to the `@overlaysys/scripture` import and replace

```ts
            verses: editingRow.slides.flatMap((s) => s.verses),
```
with
```ts
            // Merge mid-verse portions back into whole verses.
            verses: slidesToBreaks(editingRow.slides).verses,
```

- [ ] **Step 3: Add the size selector to `Step2`** — in `ScriptureRowModal.tsx`:
  - Replace `DEFAULT_SLIDE_BUDGET` in the `@overlaysys/scripture` import with nothing (remove it); add `import { budgetForPref, clampCustomChars, loadSlideSizePref, saveSlideSizePref, type SlideSizePref } from "@/lib/slideSizePref";`
  - Replace the body of `Step2` from `const templates = …` through the closing of the `ScriptureSlideEditor` wrapper `<div>` with:

```tsx
  const templates = useStore((s) => s.templates);
  const [sizePref, setSizePref] = useState<SlideSizePref>(() => loadSlideSizePref());
  const [customDraft, setCustomDraft] = useState<string>(() =>
    sizePref.kind === "custom" ? String(sizePref.maxChars) : "",
  );
  const budget = budgetForPref(sizePref);
  const [slides, setSlides] = useState<EditableSlide[]>(() =>
    seedSlides && seedSlides.length > 0
      ? seedSlides
      : splitIntoSlides(passage.verses, budget).map((s) => ({ id: s.id, verses: s.verses })),
  );
  // Saved rows count as hand-edited: their breaks may have been placed manually.
  const [manualEdits, setManualEdits] = useState<boolean>(!!seedSlides && seedSlides.length > 0);
  const [templateId, setTemplateId] = useState<string>(
    seedTemplateId || templates[0]?.id || "",
  );

  function applySize(next: SlideSizePref) {
    if (manualEdits && !window.confirm("Re-split and discard your manual breaks?")) return;
    setSizePref(next);
    saveSlideSizePref(next);
    setSlides(
      splitIntoSlides(passage.verses, budgetForPref(next)).map((s) => ({ id: s.id, verses: s.verses })),
    );
    setManualEdits(false);
  }

  return (
    <>
      <Field label="Template">
        <Select
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </Select>
      </Field>
      <Field label="Text per slide" style={{ marginTop: 12 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <Select
            value={sizePref.kind}
            onChange={(e) => {
              const kind = e.target.value as SlideSizePref["kind"];
              if (kind === "custom") {
                const maxChars = clampCustomChars(Number(customDraft) || budget.maxChars);
                setCustomDraft(String(maxChars));
                applySize({ kind: "custom", maxChars });
              } else {
                applySize({ kind });
              }
            }}
          >
            <option value="short">Short (~120 chars)</option>
            <option value="medium">Medium (~240 chars)</option>
            <option value="long">Long (~360 chars)</option>
            <option value="custom">Custom…</option>
          </Select>
          {sizePref.kind === "custom" && (
            <Input
              type="number"
              min={40}
              max={2000}
              aria-label="Max characters per slide"
              value={customDraft}
              onChange={(e) => setCustomDraft(e.target.value)}
              onBlur={() => {
                const maxChars = clampCustomChars(Number(customDraft));
                setCustomDraft(String(maxChars));
                if (maxChars !== budget.maxChars) applySize({ kind: "custom", maxChars });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              style={{ width: 100 }}
            />
          )}
        </div>
      </Field>
      <p style={{ fontSize: 12, color: colors.textDim, marginTop: 8 }}>
        Click between words to add a slide break; drag a break to move it.
      </p>
      <div style={{ marginTop: 8 }}>
        <ScriptureSlideEditor
          slides={slides}
          budget={budget}
          onChange={(next) => {
            setSlides(next);
            setManualEdits(true);
          }}
        />
      </div>
```

(The trailing Cancel/Save button row is unchanged.)

- [ ] **Step 4: Typecheck and run the full suite**

Run: `pnpm --filter @overlaysys/operator typecheck && pnpm vitest run packages/scripture apps/operator`
Expected: typecheck clean; all tests PASS. If `Input`/`Field` don't accept the `style`/`type`/`min`/`max` props used above, check `packages/ui/src/Input.tsx` / `Field.tsx` and adapt (both already accept `style` elsewhere in this modal).

- [ ] **Step 5: Manual verification** (use the `run` skill to launch the operator)
  1. Add a scripture row `John 3:16-21`. Switch Short/Medium/Long → slide count changes live.
  2. Click a gap mid-verse → new slide; reference on the take strip shows `3:16a` / `3:16b-17`.
  3. Drag a break to another gap; ✕ a break; focus a break and use ←/→ and ⇧←/⇧→.
  4. After a manual edit, change size → confirm appears; Cancel keeps breaks.
  5. Save, reopen the row → text not duplicated, breaks preserved.
  6. Pick Custom, type `5`, blur → clamps to 40.

- [ ] **Step 6: Commit**

```bash
git add apps/operator/src/app/components/ScriptureSlideEditor.tsx apps/operator/src/app/components/ScriptureRowModal.tsx
git commit -m "feat(operator): break-marker scripture slide editor with size selector"
```
