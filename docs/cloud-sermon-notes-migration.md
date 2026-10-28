# Cloud sermon notes: migration and follow-up

> superseded by `shows.extra` in docs/cloud-slides-sync-migration.md

Sermon notes (`Show.sermonNotes`) only live in the local (desktop) store for now.
The cloud `shows` table has no column for them, so:

- the cloud adapter (`packages/supabase/src/cloudStorageAdapter.ts`) and the web
  operator (`apps/operator/src/lib/cloudData.ts`) save and load shows without
  `sermonNotes`;
- as a stopgap, the local `FsStorageAdapter.saveShow`
  (`server/src/fsStorageAdapter.ts`, `keepLocalSermonNotes`) keeps the local copy's
  notes when a pulled show arrives without any. An explicit `[]` still clears them;
- the web operator (cloud mode) hides the sermon notes editor and the row notes-set
  pickers, and shows "Sermon notes are available in the desktop app." instead.

## 1. Migration (apps-portal repo)

The OverlaySys tables live in apps-portal's Supabase, in the `overlaysys` schema
(see `docs/cloud-setup.md`). Add the migration there:

```sql
alter table overlaysys.shows add column if not exists sermon_notes jsonb;
```

Regenerate the `Database` types in `packages/supabase` afterwards so
`Tables["shows"]["Row"]` includes `sermon_notes: Json | null`.

## 2. Code changes once the column exists

`packages/supabase/src/cloudStorageAdapter.ts`

- `saveShow`: add `sermon_notes: (show.sermonNotes ?? null) as unknown as Json` to
  the upserted row.
- `listShows` / `listShowsSince` / `getShow`: select `sermon_notes` along with the
  other columns.
- `rowToShow`: take `sermon_notes: unknown` and pass
  `...(row.sermon_notes != null ? { sermonNotes: row.sermon_notes } : {})` into the
  `ShowSchema.safeParse` input, so a null column still reads as "no notes".

`apps/operator/src/lib/cloudData.ts`

- `saveShowCloud`: add `sermon_notes: show.sermonNotes ?? null` to the upsert.
- `getShowCloud`: select `sermon_notes` and pass
  `...(data.sermon_notes != null ? { sermonNotes: data.sermon_notes } : {})` into
  `ShowSchema.parse`.

Then remove the stopgaps:

- `keepLocalSermonNotes` in `server/src/fsStorageAdapter.ts`. Once the cloud
  round-trips notes, an absent `sermonNotes` means "none" again.
- the `isCloudMode()` gates on the `SermonNotesEditor` and the `notesSets` pickers
  in `apps/operator/src/app/shows/edit/page.tsx`.

## 3. Same gap, already there before this

`Show.songs` and `Show.scheduledFor` are dropped the same way: `saveShow` /
`saveShowCloud` don't write them and `rowToShow` / `getShowCloud` hard-code
`songs: []` and never read a date. They need `songs jsonb` and
`scheduled_for date` (or `text`) columns, with the same mapping, in the same or a
follow-up migration.
