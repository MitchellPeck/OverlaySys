# Cloud slides sync: migration (apps-portal)

The OverlaySys tables live in apps-portal's Supabase, in the `overlaysys` schema
(see `docs/cloud-setup.md`). These migrations are written here and applied in the
apps-portal repo. They are **never applied from this repo**.

## 1. Decks and PCO mappings tables

Slides decks and remembered PCO item mappings sync the same way stage layouts do
(`docs/cloud-stage-layouts-migration.md`): JSON-payload tables, last-write-wins on
`updated_at`, soft deletes via `deleted_at`. A deck's payload is the whole `Deck`; a
mapping's payload is the whole `PcoItemMapping`, and its `id` is the mapping key
(`pcoSong:<id>` or `title:<normalised>`).

```sql
create table if not exists overlaysys.decks (
  id text not null,
  org_id uuid not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (org_id, id)
);
alter table overlaysys.decks enable row level security;
grant select, insert, update, delete on overlaysys.decks to authenticated, service_role;
create policy "decks_select_members" on overlaysys.decks for select using (overlaysys.is_org_member(org_id));
create policy "decks_insert_members" on overlaysys.decks for insert with check (overlaysys.is_org_member(org_id));
create policy "decks_update_members" on overlaysys.decks for update using (overlaysys.is_org_member(org_id));
create policy "decks_delete_members" on overlaysys.decks for delete using (overlaysys.is_org_member(org_id));
create trigger decks_updated_at before update on overlaysys.decks
  for each row execute function overlaysys.set_updated_at();

create table if not exists overlaysys.pco_item_mappings (
  id text not null,
  org_id uuid not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (org_id, id)
);
alter table overlaysys.pco_item_mappings enable row level security;
grant select, insert, update, delete on overlaysys.pco_item_mappings to authenticated, service_role;
create policy "pco_item_mappings_select_members" on overlaysys.pco_item_mappings for select using (overlaysys.is_org_member(org_id));
create policy "pco_item_mappings_insert_members" on overlaysys.pco_item_mappings for insert with check (overlaysys.is_org_member(org_id));
create policy "pco_item_mappings_update_members" on overlaysys.pco_item_mappings for update using (overlaysys.is_org_member(org_id));
create policy "pco_item_mappings_delete_members" on overlaysys.pco_item_mappings for delete using (overlaysys.is_org_member(org_id));
create trigger pco_item_mappings_updated_at before update on overlaysys.pco_item_mappings
  for each row execute function overlaysys.set_updated_at();
```

(`overlaysys.set_updated_at()` is the trigger function used by every table in
`supabase/migrations/0001_init.sql`.)

### After applying: regenerate types

Regenerate the `Database` types in `packages/supabase` so `Tables["decks"]` and
`Tables["pco_item_mappings"]` come from the live schema (hand-written entries
mirroring `stage_layouts` are in `packages/supabase/src/database.types.ts` until
then). Then run `NOTIFY pgrst, 'reload schema';` so PostgREST sees the tables at
once (see §2).

### Until applied: skipped quietly

Both kinds (`decks`, `pcoItemMappings`) are in the sync engine's `OPTIONAL_TABLES`.
When listing the remote table fails with a missing-table error (Postgres `42P01`,
PostgREST `PGRST205`, "relation … does not exist" or "Could not find the table"),
the table is skipped for that pass. It is not counted in the pass's errors, so
the sync status pill stays clean, and the server logs one info line per kind per
process:

- `[sync] remote decks table unavailable; skipping until it is migrated`
- `[sync] remote pcoItemMappings table unavailable; skipping until it is migrated`

Local decks and mappings are never touched by a skipped pass; they start syncing
on the first pass after the migration is applied. Any other failure on these
tables is still reported as a sync error.

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
