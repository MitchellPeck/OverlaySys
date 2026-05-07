# CCLI SongSelect Lyrics Import — Design

**Date:** 2026-05-07
**Status:** Draft for review
**Builds on:** [`2026-05-07-live-lyrics-design.md`](./2026-05-07-live-lyrics-design.md), which listed "CCLI SongSelect API integration" as a v1 non-goal. This spec deliberately keeps the API integration deferred and ships only the file-import / paste-tolerance pieces.

## Goals

- Operators can drop a SongSelect lyrics download (`.txt`) or ChordPro file (`.txt` / `.cho`) into OverlaySys and get a fully populated song record (metadata + sections) in one step.
- Existing `Paste lyrics…` flow tolerates the exact text shape that a SongSelect web-page copy produces, with no extra configuration.
- Adds zero data-model changes — only a new parser and two UI affordances.

## Non-goals (this spec)

- Live SongSelect API search / OAuth integration. Tracked separately as a follow-up; the parser written here is the body of work that an API integration would also need, so the API path becomes mostly a transport question.
- Parsing PowerPoint / Word / PDF SongSelect downloads. Operators paste from those instead.
- Persisting raw imported files. We extract structured data on import; the source file is not retained.
- Chord retention. ChordPro chord markers are stripped on import (lyrics-only display).

## Workflow

Two entry points, both producing the same `Song` record shape used everywhere else.

### Entry point 1 — new song from file (library page)

`apps/operator/src/app/songs/page.tsx` gains an `Import from file…` button next to `+ New Song`.

1. Operator clicks the button. A hidden `<input type="file" accept=".txt,.cho">` opens the OS picker.
2. Selected file is read as UTF-8 text. (No upload to server; parsing is client-side in the operator app.)
3. `parseSongSelectText` (see Parser, below) returns `{ meta, sections }`.
4. A confirm modal appears showing:
   - **Slug** — pre-filled with `slugify(meta.title)`, editable.
   - **Title, authors, CCLI #, copyright** — pre-filled from `meta`, editable. Each field labeled with the source line so operators can sanity-check ("CCLI Song # 4768151").
   - **Detected sections** — read-only summary list (e.g. "Verse 1, Chorus, Verse 2, Chorus, Bridge, Chorus") so the operator sees at a glance whether parsing made sense.
   - **Save / Cancel** buttons.
5. On Save:
   - If `meta.ccliNumber` is present and matches the `ccliNumber` of an existing song in the registry: show a follow-up prompt with three choices: **Replace** (keeps existing id, overwrites body + metadata), **Import as new copy** (auto-suffix slug `-2` / `-3`...), **Cancel**. If `meta.ccliNumber` is empty, no duplicate check runs (the operator can manually deduplicate). The "merge as new arrangement" option from earlier brainstorming is intentionally dropped — that's a different feature class.
   - If the slug (after suffix resolution) collides with a non-CCLI-matching existing song, append `-2` / `-3`...
   - Send `save_song` over the existing WS protocol. No new protocol.
6. On parse failure (no sections detected, empty file, etc.): the modal stays open with the failure reason shown inline. No song is created.

### Entry point 2 — paste/drop into existing song (editor page)

`apps/operator/src/app/songs/[id]/page.tsx` already has a `Paste lyrics…` modal. Extended:

1. The textarea also accepts file drops (`onDragOver` / `onDrop` reading the first file as text).
2. On `Replace song body` click, format auto-detects:
   - If the input contains SongSelect-style footer (`CCLI Song #`, `For use solely with the SongSelect® Terms of Use`, etc.) **or** bare-header sections (`Verse 1` without brackets, on its own line) **or** ChordPro-style chord markers (`[A-G][#b]?[m\d/...]?`) → `parseSongSelectText`.
   - Else → existing `parseSongFromText` (preserves backward compatibility with `[Section]`-bracket paste).
3. When `parseSongSelectText` succeeds, the modal grows a checkbox: **"Also update title / authors / CCLI # / copyright from imported file"** (default off, since the operator already opened a song record with metadata they may have hand-edited).
4. The actual update path remains the existing `setDraft` → `Save` flow. No auto-save.

## Parser

New module: `packages/core/src/songSelectParser.ts`.

```ts
export interface SongSelectMeta {
  title?: string;            // see "Title extraction" — may be absent
  authors?: string[];        // split on " | "
  ccliNumber?: string;
  copyright?: string;        // the © line, verbatim, with leading "©" preserved
}

export interface SongSelectParseResult {
  meta: SongSelectMeta;
  sections: Section[];           // same Section type used by Song
  defaultArrangement: string[];  // section ids in order encountered
}

export function parseSongSelectText(text: string): SongSelectParseResult;
```

### Pipeline

```
raw text
  → normalize newlines (\r\n / \r → \n)
  → split off trailing footer block (everything from the first
    "CCLI Song #" / "© " / "For use solely" line onward)
  → strip ChordPro chord markers from body lines: /\[[A-Ga-g][^[\]]{0,20}\]/g
    (carefully scoped so it does NOT eat [Verse 1] section markers; see below)
  → tokenize body into sections via tolerant header detector
  → emit sections + arrangement
  → parse footer block into meta (title from first non-empty pre-body line,
    authors from " | "-split line near CCLI, ccliNumber from "CCLI Song # \d+",
    copyright from "©.*" line)
```

### Tolerant header detector

Headers are recognized in this priority order:

1. **Bracketed:** `[Verse 1]`, `[Chorus]`, etc. — existing format. Use existing logic.
2. **Bare keyword line:** a line whose entire content (after trimming) matches `/^(verse|chorus|bridge|tag|intro|outro|pre[- ]?chorus|interlude|ending|coda)(\s+\d+)?$/i`. Must be on its own line (not part of a lyric).
3. Anything else is body text.

The kind-inference logic from `songParser.ts` (`pre-` / `post-` → `other`) is reused.

To avoid the chord-stripper eating section markers: chord stripping runs **after** header detection. Body lines have markers stripped; header lines are preserved as-is.

### ChordPro stripping rules

Pattern: `/\[[A-Ga-g][#b]?(?:m|maj|min|sus|aug|dim|add)?[\d/]*\]/g`. Anchored to a chord-letter start so common prose `[citation]` / `[note]` parentheticals don't get stripped. After stripping, collapse runs of 2+ spaces to one space and trim each line.

### Footer parsing

Footer detection looks for any of these markers (case-insensitive) and treats the line + everything after as footer:
- `CCLI Song #`
- `CCLI License #`
- `For use solely with the SongSelect`
- A line starting with `©` (after sections have been emitted)

From the footer:
- `ccliNumber` ← regex `/CCLI Song #\s*(\d+)/i`
- `copyright` ← the first line starting with `©`, verbatim
- `authors` ← line above the `©` line if it contains ` | `, split on ` | ` and trim
- The CCLI License # line (if present) is dropped — it identifies the *importer*, not the song, and keeping it would leak between organizations.

### Title extraction

The first non-empty line of the document **before the body section starts** (i.e. before the first detected header line), trimmed. If the body starts on line 1 (no preamble), title is `undefined` and the caller is responsible for supplying a fallback (the import-from-file button will fall back to filename minus extension).

### Slide segmentation within sections

Same rule as existing parser: blank line within a section ⇒ new slide. The section emit logic and id generation (`v1`, `c1`, etc.) is shared with `songParser.ts` via extracted helpers.

## Refactor of `songParser.ts`

The new parser shares ~70% of its logic (header → kind, kind-counts → ids, blocks → slides) with the existing one. Extract:

- `inferKind(headerText): SectionKind` — already a private function, export it.
- `generateSectionId(kind, kindCounts)` — extract.
- `emitSections(rawSections): { sections, defaultArrangement }` — extract the per-section slide emission + section-id generation.

`parseSongFromText` keeps its current public signature and behavior. Existing tests in `packages/core/src/songParser.test.ts` are unchanged and must continue to pass.

## Test fixtures

Real-shaped SongSelect output, captured under:

```
packages/core/src/__fixtures__/songselect/
  amazing-grace.txt           — plain lyrics export, multiple verses, footer
  amazing-grace.cho           — ChordPro export, same song
  cornerstone.txt             — Pre-Chorus + Chorus + Bridge structure
  build-my-life.txt           — multi-author "Pat Barrett | Brett Younker | …"
  malformed.txt               — only one section, empty body, exercise error path
  dual-title.txt              — title with parentheses, "Amazing Grace (My Chains Are Gone)"
```

Files are real outputs (or hand-fabricated to match real shape). `__fixtures__` is a conventional dir name — `vitest` picks up `*.test.ts` only, so no test exclusion glob is needed.

## Tests

`packages/core/src/songSelectParser.test.ts`:

- Plain lyrics: title, authors, CCLI #, copyright extracted; sections + arrangement match expected.
- ChordPro: same expectations as plain (chords stripped); body matches plain version.
- Bare-header detection: a fixture with `Verse 1` (no brackets) parses correctly.
- Footer not present: parser still produces sections; `meta.ccliNumber` etc. are `undefined`.
- Malformed input: throws with a useful message ("no sections detected").
- License # leak: an input containing `CCLI License # 9999` does not appear in any output field.
- Title with parentheses: `"Amazing Grace (My Chains Are Gone)"` round-trips as the title without losing the parenthetical.

`packages/core/src/songParser.test.ts`:

- Existing tests unchanged.
- Add one test confirming the post-refactor `parseSongFromText` still produces the same output for the existing `[Section]`-bracket fixture.

UI tests are not added — the file picker + modal flow is light glue, covered by the existing operator smoke path. The parser is where the risk lives, and parser is unit-tested.

## Failure modes

- **Operator drops a non-text file** (e.g. `.docx`). File reader yields garbled text; parser throws "no sections detected"; modal shows the error.
- **SongSelect changes its export format.** Footer markers are checked with multiple alternatives (`CCLI Song #`, `For use solely`, `©`); if none match, parser still produces sections from headers, just with empty metadata. Operator fills in by hand.
- **Operator imports the same song twice.** CCLI # duplicate prompt catches this on the library entry path. On the editor entry path it can't happen — they're already in a song record.
- **Multi-line copyright.** Only the first `©` line is captured. Multi-line copyright is rare and the operator can paste the rest into the editor manually.
- **Section keyword inside a lyric line.** A bare line saying `Bridge` would falsely trigger a section header. Mitigation: the regex requires the *entire* trimmed line to match a section keyword and nothing else, and lyric lines containing the word will normally be longer ("On Christ the solid rock I stand…"). Acceptable false-positive rate.

## Phasing

Single PR, three commits:

1. Refactor `songParser.ts` — extract shared helpers, no behavior change. Existing tests pass.
2. Add `songSelectParser.ts` + tests + fixtures. No UI yet.
3. Wire UI: library `Import from file…` button + modal; editor paste modal accepts file drop + auto-detect + optional metadata-update checkbox.

## Open questions

- None at the spec level. ChordPro chord regex may need tuning once we see real fixtures (e.g. slash chords like `[G/B]`, `[C#m7add9]`); the test fixtures will surface this and the regex is centralized so tuning is one-line.
