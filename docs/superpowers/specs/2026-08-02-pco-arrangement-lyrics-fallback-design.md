# Planning Center arrangement lyrics fallback — design

**Date:** 2026-08-02
**Status:** Approved, ready for implementation planning
**Related:** [`2026-08-02-pco-item-field-mapping-design.md`](./2026-08-02-pco-item-field-mapping-design.md) (independent; both touch `pcoClient.getPlanItems`)

When a Planning Center plan item's arrangement carries no lyrics, fall back to
another arrangement of the same PCO song that does.

---

## Problem

In Planning Center, lyrics live on the **arrangement**, not the song. A song
commonly has several arrangements and lyrics filled in on only one of them.

`pcoClient.getPlanItems` fetches exactly the arrangement the plan item
references (`include=song,arrangement`). If that arrangement is empty,
`buildImportedSong` creates a one-section empty stub and warns — even when the
same song has complete lyrics on a sibling arrangement sitting right there in
PCO.

This is the most likely explanation for imports that "used to" bring in lyrics
and now don't: which arrangement a plan item points at changes week to week,
and nothing about the OverlaySys code path has changed.

### What this is not

There is no CCLI SongSelect integration in this codebase and never has been.
`parseSongSelectText` exists but is wired only to two manual operator flows
(paste/drop in `PasteLyricsModal`, new-song-from-file in
`ImportFromFileModal`); it has never been imported by `server/` or
`apps/desktop/`. The original SongSelect spec
(`2026-05-07-songselect-import-design.md`, commit `368bf29`) deliberately
deferred the live API integration. A CCLI SongSelect API requires a licensing
agreement that is out of reach here, so this spec solves the problem entirely
within the Planning Center API.

---

## Design

### Fetch

`PcoClient` gains one method:

```ts
listSongArrangements(songId: string): Promise<PcoArrangement[]>
```

backed by `GET /songs/{songId}/arrangements`, using the existing `getAll`
helper so it inherits pagination and the bounded 429 retry.

`getPlanItems` calls it **only** for song items whose referenced arrangement has
no non-empty `lyrics`. Items that already have lyrics cost nothing extra. The
per-item lookups are issued concurrently.

**Cost:** one extra request per lyric-less song item. A plan with three empty
songs adds three requests to `getPlanItems`, which is already the slowest call
in the flow.

### Shape

`PcoPlanItem` gains:

```ts
/**
 * An arrangement of the same PCO song that carries lyrics, used when the
 * item's own `arrangement` has none. Absent when the item's arrangement has
 * lyrics, or when no sibling arrangement has any either.
 */
lyricsArrangement: PcoArrangementSchema.optional(),
```

`arrangement` keeps its current meaning — the arrangement this plan item
actually references — so anything displaying it stays truthful.

Selection rule: the first arrangement with non-empty `lyrics`, in the order PCO
returns them. The item's own arrangement is excluded (it is by definition
empty). No preference ordering among multiple candidates — first wins.

### Consumption

Callers take lyrics from `lyricsArrangement ?? arrangement`. There are exactly
two:

1. `server/src/pco/importPlan.ts` — the `buildImportedSong` call in the
   non-draft branch.
2. `apps/operator/src/app/pco/page.tsx` — the client-side draft builder added
   for the New-songs modal.

**`buildImportedSong` itself needs no change.** It already takes the arrangement
as a parameter; only the choice of which one to pass moves.

### Sequence travels with the lyrics

`reorderArrangementBySequence` matches sequence labels against parsed section
labels. Using arrangement Y's sequence against arrangement X's sections would
silently produce a wrong section order rather than an error. So when the
fallback supplies the lyrics, it supplies the sequence too — they are passed
together as one `PcoArrangement`, which the `lyricsArrangement ?? arrangement`
form guarantees structurally.

### Provenance stamp

`customFields[PCO_ARRANGEMENT_ID_KEY]` records the arrangement the lyrics
actually came from, not the item's. Both the draft branch and the non-draft
branch of `importPlan` currently stamp `item.arrangement.id`; both change to the
effective arrangement. Without this, a later re-import cannot tell where the
content originated.

### Visibility

The operator must always be able to see that a substitution happened:

- `buildItemPreview`'s `hasLyrics` becomes true when the fallback found lyrics
  (it currently reads only `item.arrangement.lyrics`).
- `ItemPreview` gains `lyricsFromArrangement?: string` — the source
  arrangement's name (or its id when unnamed) — so the import page can label the
  item *"lyrics from 'Acoustic in G'"* instead of silently substituting.
- When no arrangement anywhere has lyrics, behavior is unchanged: an empty stub
  plus the existing `"No lyrics found for X — created an empty stub"` warning.

---

## Testing

Pure and testable in `.ts` (Vitest never collects `.tsx`):

- **Selection** — item arrangement has lyrics → no fallback, no fetch issued;
  item arrangement empty and a sibling has lyrics → that sibling is chosen;
  several siblings have lyrics → the first in PCO order wins; no sibling has
  lyrics → `lyricsArrangement` absent.
- **Sequence** — a fallback arrangement's `sequence` is the one applied to its
  own sections, verified through `buildImportedSong`.
- **Stamp** — `pco_arrangement_id` is the fallback's id, in both the draft and
  non-draft import branches.
- **Preview** — `hasLyrics` is true and `lyricsFromArrangement` is set on a
  fallback; both are unchanged when the item's own arrangement has lyrics.
- **Client** — `listSongArrangements` and the conditional fetch, covered through
  `pcoClient`'s existing injectable `fetchImpl` (no network).

---

## Out of scope

- **CCLI SongSelect API integration.** No licensing agreement; see above.
- **Bulk SongSelect file import** (drop a folder of `.txt` exports, auto-match
  by CCLI number). A reasonable future feature that would reuse the existing
  parser, but it is a separate flow and not what fixes this.
- **PCO's item-level `custom_arrangement_sequence`.** Not fetched today;
  fetching it is a separate change.
- **Preference ordering** among multiple lyric-bearing arrangements (by name
  match, recency, or default flag). First wins.
- **Writing lyrics back to Planning Center.** Read-only, as today.
