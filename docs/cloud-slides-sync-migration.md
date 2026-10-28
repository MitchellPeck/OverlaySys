# Cloud slides sync: migration (apps-portal)

The OverlaySys tables live in apps-portal's Supabase, in the `overlaysys` schema
(see `docs/cloud-setup.md`). These migrations are written here and applied in the
apps-portal repo. They are **never applied from this repo**.

## 1. Decks and PCO mappings tables

_Added by the decks and PCO mappings sync task (P3.6)._

## 2. Show and hotcard columns

```sql
alter table overlaysys.shows add column if not exists extra jsonb;
alter table overlaysys.hotcards add column if not exists hotkey text;
```

- `shows.extra` carries every show-level field that has no column of its own:
  `sections`, `songs`, `scheduledFor`, `sermonNotes`, and any future key. It is the
  show minus `id`, `name`, `projectId`, `rows`, `updatedAt` and `deletedAt`
  (`showExtra` in `packages/supabase/src/optionalColumns.ts`). On read it spreads
  under the columned fields; a `null` `extra` (a row written before the column) reads
  as before, with `songs: []`.
- `shows.rows` stays the authority for rows. A slides row and a row's `sectionId`
  already travel inside it, because the row schemas pass unknown keys through. An
  old client that upserts only `rows` leaves `extra` intact.
- `hotcards.hotkey` is `"F1"`..`"F12"`, `"none"` for a deliberately unassigned card,
  or `null` when the card has never had a key (`hotkeyToColumn` / `hotkeyFromColumn`).

After applying, regenerate the `Database` types in `packages/supabase` and check
that `Tables["shows"]["Row"]` has `extra: Json | null` and
`Tables["hotcards"]["Row"]` has `hotkey: string | null` (both are already
hand-written into `database.types.ts`).

After applying, also:

1. Reload the PostgREST schema cache so the API sees the new columns at once.
   Otherwise requests keep failing with PGRST204 until the next automatic reload.
   Run this in the apps-portal SQL editor:

   ```sql
   NOTIFY pgrst, 'reload schema';
   ```

2. Restart the OverlaySys desktop app and reload any open web operator tabs. Once
   an adapter sees that a column is missing, it remembers that for the rest of the
   process and stops sending or selecting the column. A process that was running
   before the migration keeps syncing without `extra` / `hotkey` until it restarts.

## 3. Status

Code is in place; until applied, the cloud adapter retries without the column, and
the local stopgaps (`keepLocalSections`, `keepLocalSermonNotes`, `keepLocalHotkey`)
keep local values. Remove the stopgaps once the columns are live on every org.

The retry is in `CloudStorageAdapter` (`packages/supabase/src/cloudStorageAdapter.ts`)
and the web operator's `apps/operator/src/lib/cloudData.ts`, both through
`withOptionalColumn`: the first select or upsert that fails with 42703 / PGRST204
naming the column marks it missing for that adapter, logs once per process
(`[sync] cloud shows.extra column unavailable; …` or
`[sync] cloud hotcards.hotkey column unavailable; …`), and retries once without it.
It is never counted as a sync error. The stopgaps live in
`server/src/fsStorageAdapter.ts`.
