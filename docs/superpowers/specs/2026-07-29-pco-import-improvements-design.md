# Planning Center import improvements — design

**Date:** 2026-07-29
**Status:** Approved, ready for implementation planning

Three independent improvements to the Planning Center import flow
(`apps/operator/src/app/pco/page.tsx` and its server/core support):

1. Changing a line item's overlay template refills the new template's fields
   from the PCO plan item instead of leaving them blank.
2. Songs that the import will create get a configuration section with a
   full song editor in a modal, applied at creation time.
3. A successful import navigates to the imported show.

---

## 1. Template change refills fields from the PCO item

### Problem

`ItemCfg.data` is a flat `Record<fieldKey, string>` keyed by whichever
template was selected when the values were seeded. Switching the graphic
template keeps the old map, so the new template's inputs render empty. The
one-time seeding effect is guarded by `seededRef` keyed on `itemId`, so the
item title is never re-seeded either. Net effect: changing the template
clears the form.

Seeding today is also minimal — only the template's *first text field* is
filled, with `item.title`.

### Core: a PCO item → template field mapper

New exports in `packages/core/src/pco/mapPlanItems.ts`:

```ts
export function listPcoItemFieldDescriptors(item: PcoPlanItem): FieldDescriptor[]
export function mapPcoItemFields(
  item: PcoPlanItem,
  templateFields: TemplateFieldLike[],
): Record<string, string>
```

`listPcoItemFieldDescriptors` returns a `FieldDescriptor` (the existing type
from `songResolution.ts`) for each value the plan item actually carries;
entries with no value are omitted:

| key | label | source |
|---|---|---|
| `title` | Title | `item.title` |
| `description` | Description | `item.description` |
| `details` | Details | `item.htmlDetails`, HTML tags stripped |
| `song_title` | Song Title | `item.song.title` |
| `author` | Author | `item.song.author` |
| `ccli` | CCLI Number | `item.song.ccliNumber` |
| `copyright` | Copyright | `item.song.copyright` |
| `arrangement` | Arrangement | `item.arrangement.name` |

`mapPcoItemFields` runs those descriptors through the existing
`suggestFieldMap(templateFields, descriptors)` heuristic — exact
case-insensitive key match first, then greedy label-similarity matching —
and resolves each matched descriptor key to its value. Matches of kind
`"none"` contribute nothing. Fallback preserved from today's behavior: if
the template's first `type: "text"` field received no value, it gets
`item.title`.

Returns only non-empty values, so the caller can spread it safely.

### Import page wiring (`apps/operator/src/app/pco/page.tsx`)

- `ItemCfg` gains `edited: Set<string>` — the field keys the user has typed
  into. `onFieldChange` adds the key.
- Template change (`onGraphicTemplate`) recomputes:

  ```
  data = { ...mapPcoItemFields(item, newTemplate.fields), ...preservedEdits }
  ```

  where `preservedEdits` is the subset of `data` whose keys are in `edited`
  *and* exist in the new template's field list. Keys absent from the new
  template are dropped — they are meaningless for it.
- If the new template's body is not in `templateCache` yet, only the id is
  stored; the existing hydration effect fills the data in when the body
  arrives.
- The seeding effect uses `mapPcoItemFields` instead of the first-text-field
  logic, and its guard is re-keyed from `itemId` to `` `${itemId}:${templateId}` ``
  so a late-loading template body still seeds.
- `setKind` (item → graphic) uses the same mapper rather than its inline
  first-text-field seeding.

### Server parity

`pcoItemGraphicDefaults(item, titleField)` becomes
`pcoItemGraphicDefaults(item, templateFields)` and delegates its `data` to
`mapPcoItemFields`, so the server-side fallback (used when a client omits
`data`) produces the same values as the UI. `importPlan`'s `titleFieldFor`
memo becomes a template-fields memo. Row `notes`
(`description` + `htmlDetails`) behavior is unchanged; a description that
now also lands in a template field is acceptable duplication.

### Tests

`packages/core/src/pco/mapPlanItems.test.ts`:

- exact key match wins (template field `title` ← item title)
- label-similarity match (template field labeled "Speaker Name" vs a
  descriptor labeled "Author")
- no-match fallback fills the first text field with the item title
- items with no song/arrangement produce only item-level keys
- `pcoItemGraphicDefaults` updated for the new signature

---

## 2. Song configuration section on the import page

Only songs the import will **create** are configurable here. Items linked to
an existing library song are not listed — their configuration already lives
in the library and must not be silently overwritten.

### 2a. Extract `SongDraftEditor` (pure refactor)

`apps/operator/src/app/songs/edit/page.tsx` is 1048 lines and mixes page
concerns (routing, load, save, chrome) with a self-contained draft editor.
Split it:

**New `apps/operator/src/app/songs/edit/SongDraftEditor.tsx`** — controlled
component, props `{ draft: Song; onChange: (next: Song) => void }`. Moves in:

- the Metadata, Custom Fields, Defaults, Sections and Default Arrangement
  panels
- the intro/outro template hydration effect and the cold-cache seeding
  effects
- `introSuggestions` / `outroSuggestions` memos and the
  `introConfirmed` / `outroConfirmed` state
- `changeSubTakeTemplate`, `setMeta`, `setCustomField`, `removeCustomField`,
  `addAdHocField`, `updateSection`, `updateSlide`, `addSlide`, `removeSlide`,
  `addSection`, `removeSection`, `moveSection`
- the `ArrangementEditor` component and the `SECTION_ID_PREFIX` /
  `KIND_LABEL` constants
- its own `useDialog()` for the delete-section confirm, rendering `dialog`

Internal `setDraft(fn)` calls become `onChange(fn(draft))` against the prop.

**`page.tsx` keeps** routing/`useSearchParams`, cloud vs WS load, `save()`,
`PageChrome` (title + Paste lyrics + Save), `PasteLyricsModal`, and renders
`<SongDraftEditor draft={draft} onChange={setDraft} />`.

This is a behavior-preserving refactor: no visual or functional change to
the song edit page.

### 2b. The import page section

A `Panel` titled `New songs (N)` rendered **between** the Items panel and
the Import target panel, so the Import button remains the last control.

Listed items: `cfg.kind === "song" && cfg.songAction === "create"`. Each row
shows the song title, a pill for lyrics state (`no lyrics` when
`preview.hasLyrics === false`), a `customized` pill once the draft has been
edited, and an **Edit…** button.

**Edit…** opens `<Modal size="lg">` containing `<SongDraftEditor>` bound to
that item's draft, with Save / Cancel in the footer. Cancel discards edits;
Save commits them to the page's draft map.

**Draft construction.** Drafts live in `Record<itemId, Song>` on the page and
are built client-side with core's own builders, so the modal shows exactly
what would otherwise be created:

```ts
buildImportedSong(
  resolveImportedSongId(item.song, existingSongIds),
  item.song,
  item.arrangement,
)
```

`existingSongIds` comes from the store's song metas. A draft is built the
first time an item appears in this section and is kept until the selected
plan changes; switching an item from link → create builds one on demand.

One consequence to keep visible in the UI: when an item *does* have a
prior-import (`pco-id`) match but the operator overrides the action to
"Create new song", the server updates that existing library song in place
(section 2c). The draft is built from PCO data, so saving it replaces that
song's stored configuration. The row labels this case `updates existing`
rather than `creates new`.

The row-level **Lyric template** picker (`cfg.lyricTemplateId`, a per-row
override) and the song's `defaultLyricTemplateId` inside the modal are
separate settings that both exist today; neither is derived from the other.

### 2c. Transport and server

`ImportItemConfig` (both `server/src/pco/importPlan.ts` and
`apps/operator/src/lib/pcoClient.ts`) gains:

```ts
/** Song kind + create: a fully configured song to persist as-is. */
song?: Song;
```

In `importPlan`'s song-resolution loop, when `cfg.song` is present for a
create-kind item, it replaces the `buildImportedSong` result. The server
still owns:

- **Validation** — `SongSchema.parse(cfg.song)`; a parse failure pushes an
  `errors` entry for that item and skips it (the row is not created).
- **Identity** — the id is forced to the existing `pco_song_id`-matched
  song's id when one exists, otherwise re-resolved with
  `resolveImportedSongId` against the live library, since the client's id
  can be stale. The client-supplied `id` is never trusted.
- **PCO stamps** — `customFields[PCO_SONG_ID_KEY]` and, when an arrangement
  exists, `customFields[PCO_ARRANGEMENT_ID_KEY]` are set on top of the
  supplied `customFields`; prior `customFields` on an updated song are
  preserved underneath.
- **`updatedAt: now`.**

The empty-lyrics warning from `buildImportedSong` is not emitted when a
draft is supplied — the operator already saw and approved the content.
Counts (`songsCreated` / `songsUpdated`) are unchanged.

`/api/pco/import` keeps its current unvalidated-body typing; validation of
the new field happens inside `importPlan` as described.

### Tests

`server/src/pco/importPlan.test.ts`:

- a supplied `song` draft is persisted verbatim apart from id, PCO custom
  fields and `updatedAt`
- a supplied draft whose id collides with an unrelated library song is saved
  under a re-resolved id
- a supplied draft for an item whose PCO song was imported before reuses the
  existing library id and counts as an update
- an invalid draft produces an item error and no row

---

## 3. Open the show after import

In `doImport()`'s success path, when `result.ok && result.showId`:

- local mode: `send({ type: "get_show", showId })` so the shell's active show
  follows the import
- cloud mode: `await refreshShowMetasCloud()`
- then `router.push(\`/shows/edit?id=${encodeURIComponent(showId)}\`)`

The server already broadcasts `show_list` and `song_list` after a successful
import, so the picker refreshes without extra work in local mode.

When `result.ok` is false, the page stays put and renders the existing
result panel (errors + warnings) with an added **Open show** button when
`result.showId` is present, so failures stay readable.

Accepted trade-off: non-fatal warnings (e.g. "No lyrics found — created an
empty stub") are not seen on the success path because the page navigates
away. With section 2 in place the operator has already reviewed the song
content, which is where those warnings originate.

---

## Out of scope

- Editing configuration for *linked* (existing library) songs from the
  import page.
- Preserving song-level defaults when re-importing a previously imported
  song: `buildImportedSong` currently rebuilds the song and keeps only
  `customFields`, so `defaultLyricTemplateId`, intro/outro defaults and
  `defaultChannel` on an updated song are still dropped. Pre-existing
  behavior, unchanged here.
- Any change to the PCO auth, browse, or preview flows.
