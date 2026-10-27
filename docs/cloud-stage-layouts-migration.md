# Cloud stage layouts: migration

Stage layouts (the confidence monitor designer's stored layouts) sync to the cloud
the same way templates do: a `stage_layouts` JSON-payload table, last-write-wins on
`updated_at`, soft deletes via `deleted_at`. The code side
(`CloudStorageAdapter`, `syncEngine`, `cloudSync`) is already in place; the table is
not, until the migration below is applied.

## Migration (apps-portal repo)

The OverlaySys tables live in apps-portal's Supabase, in the `overlaysys` schema
(see `docs/cloud-setup.md`). Add this migration there. It is not applied from this repo.

```sql
create table if not exists overlaysys.stage_layouts (
  id text not null,
  org_id uuid not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (org_id, id)
);
alter table overlaysys.stage_layouts enable row level security;
grant select, insert, update, delete on overlaysys.stage_layouts to authenticated, service_role;
create policy "stage_layouts_select_members" on overlaysys.stage_layouts for select using (overlaysys.is_org_member(org_id));
create policy "stage_layouts_insert_members" on overlaysys.stage_layouts for insert with check (overlaysys.is_org_member(org_id));
create policy "stage_layouts_update_members" on overlaysys.stage_layouts for update using (overlaysys.is_org_member(org_id));
create policy "stage_layouts_delete_members" on overlaysys.stage_layouts for delete using (overlaysys.is_org_member(org_id));
create trigger stage_layouts_updated_at before update on overlaysys.stage_layouts
  for each row execute function overlaysys.set_updated_at();
```

(`overlaysys.set_updated_at()` is the trigger function used by every table in
`supabase/migrations/0001_init.sql`.)

## After applying

Regenerate the `Database` types in `packages/supabase` so `Tables["stage_layouts"]`
comes from the live schema (a hand-written entry mirroring `templates` is in
`packages/supabase/src/database.types.ts` until then).

## Until the migration is applied

The sync engine skips stage layouts: when listing the remote table fails with a
missing-table error (Postgres `42P01`, PostgREST `PGRST205`, "relation … does not
exist" or "Could not find the table"), `syncEngine` treats the table as
unavailable. It is not counted in the pass's errors, so the sync status pill
stays clean, and the server logs one info line
(`[sync] remote stageLayouts table unavailable; skipping until it is migrated`)
per process. Projects, shows, songs, templates and the rest keep syncing, and
layouts keep working locally; they start syncing on the first pass after the
migration is applied. Any other stage-layout sync failure is still reported as
an error.
