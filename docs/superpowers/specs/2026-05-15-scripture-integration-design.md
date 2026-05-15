# Scripture rundown rows

Status: design approved — pending implementation plan
Date: 2026-05-15

## Problem

The rundown supports `graphic` and `song` rows today. There is no first-
class way to put a scripture passage on screen. Operators currently have
to paste verse text into a graphic row's plain text field — losing
slide-splitting, reference-aware formatting, translation attribution,
and the ability to re-fetch or change translation without retyping.

Scripture in a live service behaves like songs: a passage breaks into
multiple slides, each slide maps onto a template, the operator advances
through them on air. The natural fit is a new rundown row kind that
mirrors `SongRow`'s shape but sources its slide content from scripture
text instead of a `Song` library entry.

## Goals

1. New `scripture` rundown row kind alongside `graphic` and `song`.
2. Operator inputs a reference (`"John 3:16-18"` or `"Rom 8:28; 1 Cor
   13:4-7"`); the system fetches the text for a chosen translation,
   auto-splits into slides, and embeds the slides in the row.
3. Operator can re-split / merge slide boundaries after auto-split.
4. Scripture slide data binds to a user-designed template via the same
   field-key convention songs already use — `text`, `reference`,
   `translation`. No new template kind.
5. Public-domain translations (KJV, WEB) bundled inside the app; ship
   fully offline-capable for those translations.
6. Provider interface that licensed translations (NIV/ESV/NLT via
   API.Bible, the ESV API, Tyndale, etc.) can plug into later without
   reworking the row data shape or the operator UX.
7. License attribution returned at fetch time is captured into the row
   so what was on air is reproducible.

## Non-goals

- Reusable scripture library (parallel to the Song library). Embedded-
  per-row only in v1; the data shape stays compatible with promoting
  embedded passages into library entries later.
- Licensed-provider implementation (API.Bible / ESV / NLT). The
  `ScriptureProvider` interface and registry land in v1, but only the
  bundled (PD) provider is wired up. Adding a licensed provider is a
  follow-up that does not change the row schema or the operator UX.
- Intro / outro sub-takes (the song-row pattern). Out of scope.
- Reactive re-fetch on translation change for already-edited slides.
  Changing translation re-fetches and re-splits from scratch, discarding
  manual slide-edits. The UI warns before doing so.
- Per-translation availability gating beyond "bundled vs not." Detailed
  rights checks (NIV cache rules, ESV 500-verse rule) land with the
  licensed provider that needs them.

## Approach

A new package `packages/scripture/` owns scripture data and lookups.
The server hosts a provider registry behind an HTTP endpoint; the
operator hits the endpoint to resolve a reference into verses, then
auto-splits client-side into a `ScriptureRow` it saves into the show
JSON. The row carries its own slides so the renderer never needs to
talk to a scripture provider at show time.

### Package layout

```
packages/scripture/
  src/
    reference.ts        # pure parser + book alias table
    types.ts            # ScripturePassage, ScriptureVerse,
                        # ScriptureProvider, TranslationMeta
    providers/
      bundled.ts        # reads bundled JSON
      registry.ts       # translationId -> provider
    bundles/
      kjv.json
      web.json
    index.ts
```

`reference.ts` is pure (no I/O) so the operator can use it for
typeahead and validation, and the server can use it for parse-on-receive.

### Data model — `packages/core/src/show.ts`

A new variant in the `RundownRow` discriminated union:

```ts
export const ScriptureSlideSchema = z.object({
  id: z.string(),
  verses: z.array(z.object({
    book: z.string(),       // canonical book id, e.g. "JHN"
    chapter: z.number().int().positive(),
    verse: z.number().int().positive(),
    text: z.string(),
  })).min(1),
});

export const ScriptureRowSchema = z.object({
  kind: z.literal("scripture"),
  id: z.string(),
  reference: z.string(),       // normalized: "John 3:16-18"
  translation: z.string(),     // translation id, e.g. "KJV"
  attribution: z.string().optional(),  // captured at fetch time
  slides: z.array(ScriptureSlideSchema).min(1),
  templateId: z.string(),
  channelHint: z.string().optional(),
  notes: z.string().optional(),
});
```

`RundownRowSchema` becomes a 3-arm discriminated union over `kind`:
`"graphic"`, `"song"`, `"scripture"`. The existing pre-discriminator
preprocess (defaults missing `kind` to `"graphic"`) is unchanged —
old shows still load.

Structured `verses` (not pre-joined strings) keeps verse-number
formatting and per-verse styling decisions on the renderer side
without re-fetching.

### Server endpoint

```
GET  /api/scripture/translations
GET  /api/scripture/passage?ref=<string>&translation=<id>
```

`translations` returns the list of providers' `TranslationMeta`
(populates the operator's translation dropdown).

`passage` parses the reference (re-validates what the operator sent),
routes to the provider for `translation`, and returns:

```jsonc
{
  "reference": "John 3:16-18",
  "translation": "KJV",
  "verses": [{ "book": "JHN", "chapter": 3, "verse": 16, "text": "..." }, ...],
  "attribution": "King James Version (public domain)"
}
```

Errors:
- `400` invalid reference (parser failure) with a structured `{ code,
  message, hint }` body — operator surfaces the hint inline next to the
  reference field.
- `404` translation id unknown.
- `502` upstream licensed-API failure (not used in v1; reserved).

### Reference parser (`packages/scripture/src/reference.ts`)

Accepts:
- Single verse: `John 3:16`
- Range: `John 3:16-18`
- Cross-chapter range: `John 3:16-4:2`
- Multi-passage list: `Rom 8:28; 1 Cor 13:4-7`
- Common aliases per book (full name, 3-letter, ambiguous-collapsed
  abbreviations like `Phil` (Philippians) vs `Phlm` (Philemon) —
  `Phil` resolves to Philippians; `Philem` / `Phlm` to Philemon).

Returns a normalized `ParsedReference[]`, each `{ book, ranges:
[{ chapter, startVerse, endVerse }] }`. Failures throw a
`ScriptureRefError` with `position` and `hint`.

The book alias table is the only place book names live. Both the
typeahead and the parser read from it.

### Slide auto-split

After verses arrive, the operator client runs `splitIntoSlides(verses,
budget)`:

- `budget` is `{ maxChars, maxLines }`, currently a fixed default
  (`maxChars: 240`, `maxLines: 4`); later read from the chosen template
  if the template advertises a budget.
- Greedy fill: append verses to the current slide until either limit
  would be exceeded; start a new slide.
- A single verse longer than the budget gets its own slide rather than
  being split mid-verse (verse boundaries are preserved in v1).

After auto-split the operator can drag verse boundaries between slides
in the slide editor; the result replaces the auto-split slides in the
row. There is no "re-run auto-split" lock — the row stores only the
final slides.

### Operator UX — new scripture row

Two-step modal, mirroring the song-row "pick song + template" flow:

1. **Reference + translation**
   - Reference text field with typeahead. Typeahead suggests book
     names from the alias table as the operator types; the parser runs
     on every keystroke and renders inline validation (green check /
     red hint).
   - "Structured picker" button opens a panel with book dropdown,
     chapter number, verse start/end. Picker writes back into the
     reference field as the normalized string so the two stay in sync.
   - Translation dropdown populated from `/api/scripture/translations`.
2. **Template + slide review**
   - Template picker (same component shared with song rows).
   - Auto-split slide preview. Each slide shows its verses; drag
     handles between slides let the operator move a verse to the
     previous / next slide.
   - "Save" persists the row into the show.

Re-opening a saved scripture row goes straight to step 2 with the
slides as last edited.

### Renderer

No renderer changes for v1: a scripture row resolves to a template
take with slide data, exactly the way song slides do. The renderer
sees `{ text, reference, translation }` field values per slide and
fills the template fields with matching keys.

Per-slide field values are computed client-side at take time:

- `text` = verses on the slide joined with line breaks; verse-number
  rendering is deferred to a follow-up (template-side option).
- `reference` = pretty reference for the slide's verse range (e.g.
  `"John 3:16"` for a single verse, `"John 3:16-17"` for two
  contiguous verses on the slide, `"John 3:16, 18"` if the operator
  merged non-contiguous verses).
- `translation` = translation abbreviation.

### Provider interface

```ts
export interface ScriptureProvider {
  readonly translations: TranslationMeta[];
  fetchPassage(
    parsed: ParsedReference[],
    translationId: string,
  ): Promise<{
    verses: ScriptureVerse[];
    attribution: string;
  }>;
}
```

`registry.ts` maps a `translationId` to the provider that owns it.
The bundled provider declares KJV + WEB. A future `apiBibleProvider`
declares whatever translations its API key gives access to and is
registered alongside.

API keys for future licensed providers live in server env
(`process.env.SCRIPTURE_API_BIBLE_KEY` etc.). The operator and
desktop never see them.

## Error handling

- **Parser failure** in the operator: inline validation prevents the
  "Continue" button. Server re-validates and returns 400 with the same
  hint shape if the operator somehow bypasses client validation.
- **Unknown translation**: dropdown only shows registered translations,
  so this is a backend-only guard (404). Reachable if a show JSON
  references a translation that's been removed from the registry — the
  row still renders from its embedded slides; only re-fetch fails.
- **Provider unavailable** (licensed provider down, no key configured):
  the registry refuses to register the provider at boot. Its
  translations don't appear in `/translations`; existing shows that
  reference them still render from embedded slides.
- **Verse out of range** (`John 99:1`): the parser only validates
  syntax and book aliases (it's pure, no per-book chapter counts).
  Chapter-exists and verse-exists checks happen in the provider.
  Surfaces as 400 with a hint identifying which reference failed.

## Testing

- `packages/scripture/src/reference.test.ts` — full parser table:
  single/range/cross-chapter/multi-passage, every alias, error cases.
- `packages/scripture/src/providers/bundled.test.ts` — round-trip
  lookups against bundled KJV/WEB, including cross-chapter ranges and
  verses-do-not-exist cases.
- `packages/core/src/show.test.ts` — schema round-trips for
  `ScriptureRow`, including old-show JSON without `kind` defaulting to
  `graphic` (regression).
- `server/test/scripture-passage.test.ts` — endpoint integration:
  valid lookup, parser failure, unknown translation, multi-passage
  list with mixed valid/invalid.
- `apps/operator/.../scripture-row.test.ts` — auto-split given fixed
  budgets, slide-edit reducers, modal state machine.
- Manual: create a scripture row in a real show, take through slides
  against a real template, confirm field bindings (`text`, `reference`,
  `translation`) render correctly and that attribution from the row is
  available to the template.

## Open questions for the plan

- Where exactly the slide-split budget lives long-term (fixed default
  vs. per-template metadata). v1 uses the fixed default; making the
  template advertise it is a one-line follow-up once a real template
  needs it.
- Whether to ship WEB alongside KJV in the initial bundle, or just
  KJV. Both are tiny (~5 MB combined gzipped); recommendation is to
  include both so the operator has a modern-English PD option.
- Verse-number rendering on the slide (`16 For God so loved...`). v1
  emits plain verse text; verse numbers are a template-side concern
  added in a follow-up so authors can style them.
