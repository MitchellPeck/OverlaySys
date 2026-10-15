# Song Arrangement Override (show + row level)

**Date:** 2026-07-19
**Status:** Design — approved, ready to plan
**Branch:** `feat/song-arrangement-override` (off `main`)

---

## Background

A `Song` in OverlaySys (`packages/core/src/song.ts`) has `sections` (verse/
chorus/bridge/…) and a `defaultArrangement: string[]` — an ordered list of
section ids defining play order, in which **sections may repeat** (e.g.
`V1, Chorus, V2, Chorus, Bridge, Chorus, Tag`).

The app has a layered override model resolved in
`packages/core/src/songResolution.ts` with the cascade **SongRow → ShowSong →
Song**:

- **`SongRow`** (`show.ts`) — one song on a rundown. Already has an optional
  `arrangement?: string[]` field, but **no editor UI**.
- **`ShowSong`** (`show.ts`) — the per-show override layer, keyed by `songId`,
  applying to that song across the whole show. Overrides channel, intro/outro
  templates + field maps + literals, lyric template, and custom fields — but
  has **no `arrangement` field**.
- Today arrangement is resolved inline in `server/src/ws.ts` (three sites:
  `song_take`, `song_take_pvw_to_pgm`, and the sub-take path) as
  `row.arrangement ?? song.defaultArrangement` — which **skips the ShowSong
  layer entirely**.

## Goal

Let the operator override a song's arrangement at the **show level** (per song,
across the whole show) and at the **row level** (one rundown row), with the full
**row → show → song** cascade, edited through a single reusable modal.

## Decisions (from brainstorming)

- **Both layers:** add arrangement to `ShowSong`; the `SongRow` field already
  exists. Surface the full cascade.
- **Editor model:** sequence + palette — the working arrangement is a row of
  reorderable chips; a palette of the song's sections appends on click (click a
  section repeatedly to repeat it); drag to reorder, × to remove.
- **Placement:** one reusable **"Edit arrangement" modal**, opened from both the
  per-show Song override panel and a rundown song row.
- **Reset semantics:** clearing an override at a level deletes that level's
  field, falling back down the cascade.

## Non-goals

- No change to the song library editor's `defaultArrangement` editing (stays in
  the song editor).
- No saved/named arrangements, no arrangement templates.
- No scripture changes. No DB migration (shows persist as JSON).

---

## Design

### 1. Data model — `packages/core/src/show.ts`

Add to `ShowSongSchema`:

```ts
/** Per-show override of the section play order. Falls back to
 *  Song.defaultArrangement. Row-level SongRow.arrangement takes precedence. */
arrangement: z.array(z.string()).optional(),
```

`SongRow` already has `arrangement?: string[]`. Optional field →
backward-compatible; `ShowSong`/`SongRow` round-trip through the existing
`save_show` path (WS + Supabase JSON blob), so **no persistence wiring and no DB
migration**.

### 2. Resolver — `packages/core/src/songResolution.ts`

Add a pure helper next to the existing resolvers:

```ts
/**
 * Resolves the effective section arrangement (ordered section ids) for a song
 * row. Cascade: SongRow.arrangement → ShowSong.arrangement →
 * Song.defaultArrangement. Returned verbatim (may contain repeats; stale ids
 * are tolerated by the runtime and filtered by the editor).
 */
export function resolveArrangement(
  row: SongRow,
  showSong: ShowSong | undefined,
  song: Song,
): string[] {
  return row.arrangement ?? showSong?.arrangement ?? song.defaultArrangement;
}
```

### 3. Wire it in — `server/src/ws.ts`

Replace the three inline `row.arrangement ?? song.defaultArrangement`
expressions (`song_take`, `song_take_pvw_to_pgm`, sub-take path) with
`resolveArrangement(row, showSong, song)`. `showSong` is already looked up in
each handler (used for channel/intro/outro resolution) — reuse it; where a
handler doesn't yet compute it, add `const showSong = show.songs.find((e) =>
e.songId === row.songId)`. Because the song session binds this arrangement to
the STT matcher (`server/src/songSession.ts`), show-level overrides
automatically flow to speech-driven advancing too.

### 4. The modal — `apps/operator/src/app/shows/edit/ArrangementModal.tsx`

Built on the shared `Modal` primitive (`@overlaysys/ui`).

**Props:**
```ts
{
  song: Song;                        // sections + defaultArrangement
  level: "show" | "row";             // banner label
  value: string[] | undefined;       // this level's current override (undefined = inheriting)
  inherited: string[];               // fallback if cleared
  onSave: (next: string[] | undefined) => void;  // undefined = clear override
  onClose: () => void;
}
```

**Behavior:**
- Local working state seeded from `value ?? inherited`. On open, **filter out
  ids not present in `song.sections`** and, if any were dropped, show a note
  ("N section(s) removed — no longer in the song").
- **Inheritance banner:** states whether this level is inheriting or overriding
  and names the fallback source (show → "Song default"; row → "Show
  arrangement" or "Song default" depending on whether a show override exists). A
  **"Reset to inherited"** button calls `onSave(undefined)` and closes.
- **Sequence:** ordered chips (section id → its label), keyed by **position**
  (not id, since ids repeat); drag handle reorders, × removes. Chorus/Bridge get
  subtle accent colors.
- **Palette:** one `+ {label}` button per `song.sections`; click appends that
  id (repeat-friendly).
- **Empty state:** if the working sequence is empty, offer "Start from
  inherited" (loads `inherited`). **Save is disabled while empty** — an empty
  override is meaningless; use Reset instead. A saved arrangement is always
  non-empty.
- **Save** calls `onSave(working)`.

### 5. Integration — two buttons, one modal

- **`SongRowEditor`** (`shows/edit/page.tsx`, near the "Edit slides…" button):
  add an **"Arrangement…"** button + a compact inline summary of the effective
  order (e.g. `V1 · C · V2 · C · B · C · Tag`). Opens the modal with
  `level="row"`, `value=row.arrangement`,
  `inherited = showSong?.arrangement ?? song.defaultArrangement`; on save →
  `patchRow({ arrangement: next })`, deleting the key when `next` is `undefined`.
- **`SongOverrideEditor`** (`shows/edit/SongOverrideEditor.tsx`): add an
  **"Arrangement…"** control + inline summary. Opens the modal with
  `level="show"`, `value=entry.arrangement`,
  `inherited = song.defaultArrangement`; on save → `onChange({ arrangement:
  next })` (delete key when `undefined`).
- Section id → label lookup uses `song.sections` (each section has an
  id + label). Both editors already hold the `Song` from `songCache`.

---

## Testing

- **Unit (pure, node harness):** extend the `songResolution` test file with
  `resolveArrangement` cases — row overrides show overrides song; `undefined` at
  a level falls through; all-undefined → `song.defaultArrangement`.
- **Schema round-trip:** `ShowSongSchema` parses a value with and without
  `arrangement` (add to core show tests if a test file exists).
- **Regression:** `pnpm typecheck` + `pnpm test` green.
- **Visual/interactive (real-app boot, `/run`):** open the modal from a row and
  from the Song override panel; add / reorder / remove / repeat sections; Save;
  Reset-to-inherited; reopen and confirm persistence + inline summary; confirm
  taking the song plays the overridden order.

## Acceptance criteria

- [ ] `ShowSongSchema` has optional `arrangement`; `SongRow` unchanged (already
      has it).
- [ ] `resolveArrangement(row, showSong, song)` implements row → show → song;
      unit-tested.
- [ ] The three `ws.ts` arrangement sites use `resolveArrangement`.
- [ ] `ArrangementModal` implements the sequence+palette editor with inheritance
      banner, reset-to-inherited, stale-id filtering, empty-save disabled.
- [ ] Opened from both `SongRowEditor` (writes `row.arrangement`) and
      `SongOverrideEditor` (writes `showSong.arrangement`); clearing deletes the
      field.
- [ ] Both editors show an inline effective-arrangement summary.
- [ ] `pnpm typecheck` + `pnpm test` green; visual walk clean.

## Risks

- **Stale section ids** after a song is edited: resolver returns verbatim
  (runtime tolerates), editor filters on open and warns. Low impact.
- **Repeated ids:** chips must key by position, not id, or React keys collide.
  Called out explicitly in the modal design.
- **`showSong` lookup in ws.ts:** must use the same `showSong` the other
  resolvers use so the cascade is consistent; verify each of the three sites.
