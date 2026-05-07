# Import / Export — Design

**Date:** 2026-05-07
**Status:** Draft for review
**Scope:** Operator-facing import and export for the three first-class entity types — `Song`, `Template`, `Show`. Both single-entity (one JSON file per item) and multi-entity bundle (`.bundle.json` carrying selected items + their dependencies) flows.

## Goals

- Operators can move shows, songs, and templates between machines without manually copying files out of `data/`.
- One-click "Export" from each list page produces a portable JSON file.
- A central `/data` page handles bulk operations: bundle export with dependency resolution, and all imports (single or bundle) with conflict preview + per-item Replace / Skip choice.
- No server-side protocol changes. Reuses existing `save_*` and `list_*` WS messages.

## Non-goals

- Image / video binary asset bundling. Templates reference assets by URL/path; bundles do not embed binaries. Future work if assets ever need to travel.
- Fine-grained merge (field-level merge of two conflicting songs). Conflict resolution is whole-entity Replace or Skip.
- Cross-reference rewriting (auto-renaming an imported song to avoid an id collision and rewriting any show that references it). Out of scope; Replace / Skip is enough.
- A backup/restore *scheduling* feature. Manual export only.
- Cloud sync. Bundles travel by file copy or operator's own transport (USB stick, email, etc.).

## Format

### Single-entity export

The entity's existing JSON (matches the on-disk shape in `data/<entity>/<id>.json`). One file per click. Filename: `<id>.json` (sanitised for filesystem). The entity is round-trippable with itself by design — exporting and re-importing changes nothing.

### Bundle export — `.bundle.json`

```json
{
  "format": "overlaysys-bundle",
  "version": 1,
  "exportedAt": "2026-05-07T18:30:00Z",
  "name": "Easter Sunday show",
  "songs": [/* full Song objects */],
  "templates": [/* full Template objects */],
  "shows": [/* full Show objects */]
}
```

- `format: "overlaysys-bundle"` is the discriminator. Import code auto-detects bundle vs single by checking for this field.
- `version: 1` reserved for future migration paths.
- `name` is operator-chosen (free text). Optional. Defaults to filename minus `.bundle.json` on import.
- Empty arrays allowed; absent arrays treated as empty.
- Each array contains the full entity, identical to its on-disk shape.

The bundle is hand-readable JSON. No zip, no binary, no compression. For typical worship show sizes (a few shows, dozens of songs, a handful of templates) the file is well under 200 KB.

## Cross-reference resolution

### What references what

- `Song.defaultLyricTemplateId?` → Template
- `Show.rows[].kind === "graphic"` → `templateId` (Template)
- `Show.rows[].kind === "song"` → `songId` (Song) AND `lyricTemplateId` (Template)
- `Template` is a leaf; no outbound entity references.

### `collectDependencies(selection, store)`

Lives in `packages/core/src/bundle.ts`. Pure function. Given an initial selection of entities-by-id and a store snapshot of all known entities, returns the dep-closed selection plus a list of missing references.

```ts
export interface BundleSelection {
  songIds: string[];
  templateIds: string[];
  showIds: string[];
}

export interface BundlePayload {
  songs: Song[];
  templates: Template[];
  shows: Show[];
  missing: { kind: "song" | "template"; id: string; referencedBy: string }[];
}

export function collectDependencies(
  selection: BundleSelection,
  store: { songs: Map<string, Song>; templates: Map<string, Template>; shows: Map<string, Show> },
): BundlePayload;
```

Algorithm:

1. Start with `selection` ids in three sets.
2. For each `showId` in selection: for each row, add `templateId` (graphic) or `songId` + `lyricTemplateId` (song) to the respective set.
3. For each `songId` in the (now-expanded) song set: add `defaultLyricTemplateId` if present.
4. Resolve every id to its entity from the store. If an id has no matching entity, record a `missing` entry and **omit it** from the bundle payload (no placeholder, no fake entity).
5. Return the resolved entities plus the `missing` list.

The `missing` list is shown as a warning in the export UI ("3 references couldn't be resolved and will be excluded from the bundle"). The operator decides whether to proceed.

### Order of saves on import

Schema validation does not require cross-references to resolve at write time. Save order is therefore not load-bearing for correctness, but the import code saves in this order anyway for predictable behavior in the operator UI as `list_*` updates trickle in:

1. Templates (no deps)
2. Songs (may reference Templates)
3. Shows (may reference Songs and Templates)

## UI

### List pages — per-row "Export" button

Three list pages get one new column / button per row:

- `/songs` — `apps/operator/src/app/songs/page.tsx`
- `/shows` — `apps/operator/src/app/shows/page.tsx`
- `/design` (templates list) — `apps/operator/src/app/design/page.tsx`

The button label is "Export" (or a small download icon). Click handler:

1. Reads the entity from the store (e.g., `useStore.getState().songCache[id]` or fetch via `get_song` if not cached).
2. Builds a `Blob` of `JSON.stringify(entity, null, 2)`.
3. Triggers a download via a hidden `<a>` element with `download="<id>.json"`.

Pure client-side. No new WS message, no server roundtrip beyond the existing get-or-cache.

### `/data` page (new)

Top-level nav link added to whatever shared nav lives in `AppHeader` or equivalent. The page has two collapsible sections.

#### Export bundle

```
┌── Export bundle ───────────────────────────────┐
│ Bundle name: [Easter Sunday show           ]   │
│ ☑ Include referenced dependencies              │
│                                                 │
│ Songs       Shows       Templates              │
│ ──────────  ──────────  ──────────             │
│ ☐ Amazing Grace                                 │
│ ☐ Build My Life                                 │
│ ☑ For The Beauty…                               │
│ …                                               │
│                                                 │
│ ⚠ Show 'Easter' references song 'tbd-song-id'  │
│   which doesn't exist locally — will be omitted │
│                                                 │
│ [Download bundle]                              │
└────────────────────────────────────────────────┘
```

Behavior:

- Three tabs (Songs / Shows / Templates) each rendered as a checkbox list. The store already has `songs`/`showMetas`/`templates` lists.
- "Include referenced dependencies" toggle. When on, before serialising, the selection is run through `collectDependencies` and the resolved set goes into the bundle. When off, only directly-checked items are bundled.
- Missing references are shown inline as a warning panel (collapsible "X warnings" header).
- "Download bundle" assembles the bundle JSON and triggers a browser download named `<bundleName>.bundle.json` (slugified) or `overlaysys.bundle.json` if name is blank.
- Disabled when nothing is selected.

#### Import

```
┌── Import ──────────────────────────────────────┐
│ [Choose file…]   Or drop a file here           │
│                                                 │
│ ── Preview ────                                 │
│ Songs (3):                                      │
│   • amazing-grace            new                │
│   • for-the-beauty-of-…      conflict ▢ Replace │
│                                       ▣ Skip   │
│   • build-my-life            new                │
│ Templates (1):                                  │
│   • template-9ff5e970        conflict ▢ Replace │
│                                       ▣ Skip   │
│ Shows (1):                                      │
│   • easter-sunday            new                │
│                                                 │
│ [Save 3 items, skip 2]                         │
└────────────────────────────────────────────────┘
```

Behavior:

- File picker accepts `.json`. Drag-and-drop also supported on the section.
- File text is parsed and shape-detected:
  1. If JSON has `"format": "overlaysys-bundle"` → bundle.
  2. Else, try each entity schema in this order — Song, Template, Show — and use the first that validates. (The schemas are distinct enough that this is unambiguous: Song has `sections`, Show has `rows`, Template has `layers`.)
  3. If neither, show inline error.
- Preview lists every entity grouped by type. Each row labels:
  - **new** — id doesn't exist locally.
  - **conflict (replaces *<existing-title>*)** — id matches an existing entity. Renders a Replace / Skip radio pair, defaulting to **Skip**.
- A bottom action button "Save N items, skip M" reflects the current choice tally. On click, sends one `save_*` WS message per item to be saved (skipped items are not sent). No transaction; ordering is templates → songs → shows.
- Result toast on completion: "Imported N items." Errors per-item logged inline (rare — schema-validated already).

### Format auto-detection (single vs bundle)

Implemented as a pure function in `packages/core/src/bundle.ts`:

```ts
export type Detected =
  | { kind: "bundle"; bundle: Bundle }
  | { kind: "song"; song: Song }
  | { kind: "template"; template: Template }
  | { kind: "show"; show: Show }
  | { kind: "error"; message: string };

export function detectImport(json: unknown): Detected;
```

Flow:

1. If `json.format === "overlaysys-bundle"` → parse with `BundleSchema`.
2. Else attempt `SongSchema.safeParse`, `TemplateSchema.safeParse`, `ShowSchema.safeParse` (in that order). First success wins.
3. Else `kind: "error"`.

## Architecture & file map

### Created

- `packages/core/src/bundle.ts` — `BundleSchema` (Zod), `collectDependencies`, `detectImport`. Pure functions.
- `packages/core/src/bundle.test.ts` — schema validation, dep resolution (incl. missing-ref behavior), format detection.
- `apps/operator/src/lib/download.ts` — small helper: `downloadJson(filename: string, value: unknown)`. Builds Blob + triggers download.
- `apps/operator/src/app/data/page.tsx` — the `/data` page (export bundle section + import section + preview).
- `apps/operator/src/app/data/ImportPreview.tsx` — preview/confirm UI for an imported bundle or single entity.
- `apps/operator/src/app/data/ExportBundle.tsx` — export-bundle section UI (selection lists + warnings + download trigger).

### Modified

- `apps/operator/src/app/songs/page.tsx` — add per-row "Export" button.
- `apps/operator/src/app/shows/page.tsx` — add per-row "Export" button.
- `apps/operator/src/app/design/page.tsx` — add per-row "Export" button.
- `packages/core/src/index.ts` — export the new `bundle` module.
- Wherever the global nav is defined (likely `apps/operator/src/app/components/AppHeader.tsx` or `layout.tsx`) — add a link to `/data`.

### Unchanged

- Server (`server/src/`) — no protocol or storage changes.
- WS protocol (`packages/ws-protocol/src/index.ts`) — no new messages.
- Renderer — no changes.

## Failure modes & recovery

- **Invalid JSON file dropped on import** — `JSON.parse` throws; inline error shown; no save.
- **JSON parses but doesn't match any known shape** — `detectImport` returns `{ kind: "error" }`; inline error shown.
- **Bundle has a stale schema** — Zod validation fails on individual entities; the offending entity is listed in the preview as "skipped (validation failed: <msg>)" and excluded from the save list. Other entities still importable.
- **Operator selects nothing for export** — Download button is disabled.
- **Operator exports a show whose referenced song is missing locally** — Warning appears in the export panel; the show is still bundled (the show entity is valid even if its references dangle); operator decides whether to proceed.
- **Import a bundle that references entities outside the bundle** — Imported show keeps its references as-is; if the referenced songs/templates don't exist locally and aren't in the bundle, they show as "(missing)" in the rundown when the operator opens the show. No special UI for this in import — it's the same dangling-ref behavior the system already tolerates.
- **Concurrent edits during import** — Last write wins (matches existing `save_*` semantics). No transaction.

## Testing strategy

### Unit (`packages/core/src/bundle.test.ts`)

- `BundleSchema` round-trips a valid bundle.
- `collectDependencies`:
  - Show in selection → its songs and templates are pulled in.
  - Song in selection → its `defaultLyricTemplateId` is pulled in.
  - Template in selection → no deps pulled.
  - Show row referencing missing song → recorded in `missing`, omitted from payload.
  - No double-add when two shows reference the same template.
- `detectImport`:
  - Bundle JSON → `kind: "bundle"`.
  - Song JSON → `kind: "song"`.
  - Template JSON → `kind: "template"`.
  - Show JSON → `kind: "show"`.
  - Garbage → `kind: "error"`.

### UI (light)

The new modals are mostly glue. Manual smoke covers the user flows:

- Per-row export → download triggers, file content matches `JSON.stringify(entity, null, 2)`.
- `/data` export bundle → tick a show, "Include deps" on, download. Open the file, verify `songs`/`templates`/`shows` arrays populated.
- `/data` import → drop a bundle, see preview with conflict markers, choose Replace on one, Skip on another, click Save. Confirm only the chosen items got saved (verify by checking the corresponding `data/<entity>/<id>.json` files).

## Phasing

Single PR, three commits:

1. Core: `bundle.ts` + tests + `index.ts` export.
2. UI primitives: `download.ts` + per-row export buttons on the three list pages.
3. `/data` page: export-bundle section + import section + preview + nav link.

## Open questions

- None at the spec level. The "Include referenced dependencies" toggle could grow to a "deep" vs "selected only" granularity later if there's demand for excluding the templates of imported songs (etc.), but YAGNI for v1 — bundle deps by default.
