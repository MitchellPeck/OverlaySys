# Scripture slide splitting — design

Date: 2026-10-21
Status: approved in chat, awaiting spec review

## Problem

When importing scripture, operators can't control how much text lands on each
slide, and shifting text between slides is clumsy.

- The slide budget is hard-coded (`DEFAULT_SLIDE_BUDGET` = 240 chars / 4
  verses in `packages/scripture/src/slideSplit.ts`) with no UI.
- `ScriptureSlideEditor` only offers per-verse ◀/▶ buttons, so moving a
  boundary means clicking verse by verse, and a verse can never be split.

## Goals

1. Operator chooses slide size at import (and when editing a saved row), with
   live re-split.
2. Operator can place a slide break between **any two words**, including
   mid-verse, and add/remove/move breaks directly.
3. No breaking change to saved shows.

Non-goals: per-slide free-text editing, changing the renderer, changing
Companion variables (they use `row.reference`, not per-slide labels).

## Data model — no schema change

`ScriptureSlideSchema` (`packages/core/src/show.ts`) is unchanged. A partial
verse is represented by the same `{book, chapter, verse}` appearing on more
than one slide in a row, each entry's `text` holding its portion.

- Old rows load unchanged; rows with partial verses still validate and render
  on older builds.
- Two portions of the same verse never share a slide (the editor model makes
  that impossible — see below).
- Rebuilding the full passage for editing: concatenate portions of the same
  verse, in slide order, joined with a single space.

## Splitting logic — `packages/scripture/src/slideSplit.ts`

### Word/break model

```ts
interface PassageWord { verseIdx: number; text: string }   // verseIdx into verses[]
type Breaks = Set<number>;  // word index where a new slide starts; never 0, never >= words.length

tokenize(verses: ScriptureVerse[]): PassageWord[]          // split each verse on whitespace
breaksToSlides(verses, words, breaks): AutoSlide[]         // regroups words → slides of verse portions
slidesToBreaks(slides): { verses: ScriptureVerse[]; words: PassageWord[]; breaks: Breaks }
```

`breaksToSlides` joins a verse's words on one slide with single spaces. Text is
whitespace-normalized as a consequence; that is acceptable.

Round-trip invariant: `breaksToSlides(slidesToBreaks(s))` deep-equals `s`
(modulo whitespace normalization and slide ids).

### Auto-split

`splitIntoSlides(verses, budget)` keeps its signature. Budget:

```ts
interface SlideBudget { maxChars: number; maxLines?: number }  // maxLines optional, default off
```

Algorithm (greedy by characters, verse is the preferred unit):

1. Add whole verses to the current slide while total chars ≤ `maxChars`
   (and verse count ≤ `maxLines` when set).
2. If the next verse doesn't fit and the current slide is non-empty, flush.
3. If a single verse alone exceeds `maxChars`, split it: cut at the last
   sentence/clause punctuation (`. ; : ,` followed by a space, also `?` `!`)
   at or before `maxChars`; if none, cut at the last space before
   `maxChars`; if no space, keep the verse whole. Repeat on the remainder.

### Presets

```ts
export const SLIDE_SIZE_PRESETS = {
  short:  { maxChars: 120 },
  medium: { maxChars: 240 },   // == DEFAULT_SLIDE_BUDGET
  long:   { maxChars: 360 },
} as const;
```

Plus "Custom" (number input, clamped 40–2000). The last selection is stored
per operator in `localStorage` (wrapped in try/catch; falls back to medium).

## Reference labels — `ScriptureTakeStrip.tsx`

`prettyReferenceForSlide(slide)` becomes `prettyReferenceForSlide(row, slideIdx)`.
For each verse entry, if that verse appears on more than one slide in the row,
append a suffix letter by order of appearance (`a`, `b`, `c`…). Examples:

- slide holding first half of 3:16 → `John 3:16a`
- slide holding second half of 3:16 and all of 17 → `John 3:16b–17`
- cross-chapter runs (`3:36b–4:2`) keep the existing contiguity rules; a
  suffixed verse is contiguous with its neighbour verse as before.

The `text` sent on take stays `verses.map(v => v.text).join("\n")`.

## Editor UI — `ScriptureSlideEditor.tsx` (rewrite)

Props unchanged (`slides`, `onChange`) plus `budget: SlideBudget` for
over-budget highlighting. Internally it derives `{verses, words, breaks}` via
`slidesToBreaks` and emits `breaksToSlides(...)` on every change.

- **Layout:** one continuous scrolling text block. Verse numbers as small bold
  superscripts at the start of each verse. Each break renders as a full-width
  bar `Slide N` with a ✕ button. Each slide section shows its live character
  count; over-budget sections are tinted amber (tokens from `@overlaysys/ui`
  `colors`).
- **Add break:** hovering a gap between two words shows a thin insert line;
  click inserts a break there. Gaps at verse boundaries get a larger hit area.
- **Remove break:** click ✕ → slides merge.
- **Move break:** drag the bar onto any word gap; a drop indicator previews the
  new position. Keyboard: a focused break moves ←/→ one word, ⇧←/⇧→ to the
  previous/next verse boundary. Delete/Backspace removes it.
- **Invariants:** no break at index 0 or ≥ words.length; no duplicate breaks
  (Set); therefore no empty slides.
- Slide ids: preserve existing ids for slides whose first word index is
  unchanged; mint new ids with the existing `nextSlideId` pattern otherwise.

## Import flow — `ScriptureRowModal.tsx` Step2

- Slide-size selector (Short / Medium / Long / Custom) above the editor, in
  both new-import and edit-row modes.
- Changing it re-runs `splitIntoSlides` on the full passage. If the operator
  has manually changed breaks since the last auto-split, confirm first:
  "Re-split and discard your manual breaks?"
- When editing a saved row, the selector starts at the stored preference and
  the saved breaks are kept until the operator changes the size.

## Testing

- `slideSplit.test.ts`
  - tokenize / breaksToSlides / slidesToBreaks round-trip, including partial verses
  - long verse splits at punctuation; falls back to space; no-space verse stays whole
  - presets produce expected slide counts on a fixed passage (John 3:16–21)
  - `maxLines` omitted = no verse-count limit
- `ScriptureSlideEditor` component tests: add / remove / drag-equivalent move /
  keyboard move of breaks; empty slides impossible; ids preserved for
  untouched slides.
- `ScriptureTakeStrip` label tests: `16a`, `16b–17`, cross-chapter
  `3:36b–4:2`, rows with no partial verses unchanged.
- `ScriptureRowModal`: changing size re-splits; confirm shown only after manual edits.
