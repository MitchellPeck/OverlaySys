# Cloud media sync: migration (apps-portal)

The OverlaySys tables live in apps-portal's Supabase, in the `overlaysys` schema
(see `docs/cloud-setup.md`). This migration is written here and applied in the
apps-portal repo. It is **never applied from this repo**.

## 1. Media items table

The media library (uploaded files and live-folder entries) syncs the same way slides
decks do (`docs/cloud-slides-sync-migration.md`): a JSON-payload table, last-write-wins
on `updated_at`, soft deletes via `deleted_at`. A row's payload is the whole
`MediaItem`. A live folder's path is per machine and is never part of the payload.

```sql
create table if not exists overlaysys.media_items (
  id text not null,
  org_id uuid not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (org_id, id)
);
alter table overlaysys.media_items enable row level security;
grant select, insert, update, delete on overlaysys.media_items to authenticated, service_role;
create policy "media_items_select_members" on overlaysys.media_items for select using (overlaysys.is_org_member(org_id));
create policy "media_items_insert_members" on overlaysys.media_items for insert with check (overlaysys.is_org_member(org_id));
create policy "media_items_update_members" on overlaysys.media_items for update using (overlaysys.is_org_member(org_id));
create policy "media_items_delete_members" on overlaysys.media_items for delete using (overlaysys.is_org_member(org_id));
create trigger media_items_updated_at before update on overlaysys.media_items
  for each row execute function overlaysys.set_updated_at();
```

(`overlaysys.set_updated_at()` is the trigger function as redefined in
`supabase/migrations/0010_project_publish_fixes.sql`: it stamps `now()` only when
the writer leaves `updated_at` unchanged, so the sync engine's explicit value
survives a conflict-update.)

### After applying: regenerate types

Regenerate the `Database` types in `packages/supabase` so `Tables["media_items"]`
comes from the live schema (a hand-written entry mirroring `decks` is in
`packages/supabase/src/database.types.ts` until then). Then run
`NOTIFY pgrst, 'reload schema';` in the apps-portal SQL editor so PostgREST sees the
table at once.

### Until applied: skipped quietly

`media` is in the sync engine's `OPTIONAL_TABLES`. When listing the remote table
fails with a missing-table error (Postgres `42P01`, PostgREST `PGRST205`,
"relation ... does not exist" or "Could not find the table"), the table is skipped
for that pass. It is not counted in the pass's errors, so the sync status pill stays
clean, and the server logs one info line per process:

- `[sync] remote media table unavailable; skipping until it is migrated`

Local media items are never touched by a skipped pass; they start syncing on the
first pass after the migration is applied. Any other failure on this table is still
reported as a sync error.

Uploaded files themselves are not in this table: an item carries only its
`assetUrl`, and the file bytes travel through the existing asset sync.
