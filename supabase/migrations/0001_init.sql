-- OverlaySys cloud schema v1
--
-- Applied to apps-portal's Supabase project, under a dedicated
-- `overlaysys` schema. We do NOT create our own orgs/users tables:
-- membership is checked against apps-portal's `public.orgs.members`
-- (text[] of user IDs) via RLS.
--
-- Mirrors the Zod schemas in packages/core/src/* so that import/export
-- bundles round-trip without lossy conversion. Every entity row carries
-- an `org_id` (referencing public.orgs.id) denormalized from its
-- containing project so RLS policies can scope by membership without
-- recursive joins.

-- ─── schema ─────────────────────────────────────────────────────────────────

create schema if not exists overlaysys;

-- Allow authenticated users to see the schema. Per-row access is gated by
-- RLS policies on each table.
grant usage on schema overlaysys to authenticated;
grant usage on schema overlaysys to service_role;

-- ─── projects ───────────────────────────────────────────────────────────────

create table overlaysys.projects (
  -- Slug, e.g. "sunday-services". Globally unique only within an org, so
  -- the primary key is (org_id, id). Composite PK keeps imports simple.
  id text not null,
  -- References apps-portal's public.orgs.id. No FK constraint because
  -- crossing schemas with a FK gets brittle if apps-portal restructures.
  -- Membership is enforced at the RLS layer instead.
  org_id uuid not null,
  name text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, id)
);

-- ─── shows ──────────────────────────────────────────────────────────────────
--
-- Shape mirrors ShowSchema verbatim. `rows` is the discriminated-union
-- RundownRow[] from packages/core/src/show.ts, stored as jsonb. We do NOT
-- validate row shape at the database layer; the Zod schema does that on
-- both publish (server-side) and read (operator side).

create table overlaysys.shows (
  id text not null,
  org_id uuid not null,
  project_id text not null,
  name text not null,
  rows jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (org_id, id),
  foreign key (org_id, project_id)
    references overlaysys.projects(org_id, id) on delete cascade
);

create index shows_project_idx on overlaysys.shows (org_id, project_id);

-- ─── hotcards ───────────────────────────────────────────────────────────────

create table overlaysys.hotcards (
  id text not null,
  org_id uuid not null,
  project_id text not null,
  name text not null,
  template_id text not null,
  data jsonb not null default '{}'::jsonb,
  channel_hint text,
  notes text,
  updated_at timestamptz not null default now(),
  primary key (org_id, id),
  foreign key (org_id, project_id)
    references overlaysys.projects(org_id, id) on delete cascade
);

create index hotcards_project_idx on overlaysys.hotcards (org_id, project_id);

-- ─── songs (org library) ────────────────────────────────────────────────────
--
-- Songs are shared across all projects in an org. Stored as a single
-- jsonb `payload` to keep the schema flexible — SongSchema may grow new
-- optional fields (alternate languages, transposition, etc.) without a
-- migration.

create table overlaysys.songs (
  id text not null,
  org_id uuid not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (org_id, id)
);

-- ─── templates (org library) ────────────────────────────────────────────────

create table overlaysys.templates (
  id text not null,
  org_id uuid not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (org_id, id)
);

-- ─── asset_index ────────────────────────────────────────────────────────────
--
-- Metadata for binary assets. The bytes live in Supabase Storage under
-- bucket `overlaysys-assets`, object path `<org_id>/<sha256>.<ext>`.
-- Content addressing means a re-upload of the same bytes is a cheap
-- no-op (insert or update on sha256 conflict).

create table overlaysys.asset_index (
  sha256 text not null,
  org_id uuid not null,
  mime text,
  size bigint,
  created_at timestamptz not null default now(),
  primary key (org_id, sha256)
);

-- ─── grants ─────────────────────────────────────────────────────────────────
--
-- Grant the authenticated role table-level access so RLS can govern rows.
-- Without this, RLS doesn't get a chance — Postgres rejects the query at
-- the GRANT layer.

grant select, insert, update, delete on all tables in schema overlaysys
  to authenticated;
grant select, insert, update, delete on all tables in schema overlaysys
  to service_role;

-- ─── RLS ────────────────────────────────────────────────────────────────────
--
-- Every row scoped by org_id is readable/writable by org members. Service
-- role bypasses RLS by default in Postgres so backend operations (publish,
-- bootstrap, GC) work without explicit grants.
--
-- Membership check: `auth.uid()::text = ANY(public.orgs.members)`.
-- A SECURITY DEFINER helper keeps the per-policy SQL short and avoids
-- giving authenticated users SELECT on public.orgs directly.

create or replace function overlaysys.is_org_member(check_org_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1
    from public.orgs
    where id = check_org_id
      and (auth.uid()::text) = any(members)
  );
$$;

grant execute on function overlaysys.is_org_member(uuid) to authenticated;

alter table overlaysys.projects enable row level security;
alter table overlaysys.shows enable row level security;
alter table overlaysys.hotcards enable row level security;
alter table overlaysys.songs enable row level security;
alter table overlaysys.templates enable row level security;
alter table overlaysys.asset_index enable row level security;

-- projects
create policy "projects_select_members" on overlaysys.projects
  for select using (overlaysys.is_org_member(org_id));
create policy "projects_insert_members" on overlaysys.projects
  for insert with check (overlaysys.is_org_member(org_id));
create policy "projects_update_members" on overlaysys.projects
  for update using (overlaysys.is_org_member(org_id));
create policy "projects_delete_members" on overlaysys.projects
  for delete using (overlaysys.is_org_member(org_id));

-- shows
create policy "shows_select_members" on overlaysys.shows
  for select using (overlaysys.is_org_member(org_id));
create policy "shows_insert_members" on overlaysys.shows
  for insert with check (overlaysys.is_org_member(org_id));
create policy "shows_update_members" on overlaysys.shows
  for update using (overlaysys.is_org_member(org_id));
create policy "shows_delete_members" on overlaysys.shows
  for delete using (overlaysys.is_org_member(org_id));

-- hotcards
create policy "hotcards_select_members" on overlaysys.hotcards
  for select using (overlaysys.is_org_member(org_id));
create policy "hotcards_insert_members" on overlaysys.hotcards
  for insert with check (overlaysys.is_org_member(org_id));
create policy "hotcards_update_members" on overlaysys.hotcards
  for update using (overlaysys.is_org_member(org_id));
create policy "hotcards_delete_members" on overlaysys.hotcards
  for delete using (overlaysys.is_org_member(org_id));

-- songs
create policy "songs_select_members" on overlaysys.songs
  for select using (overlaysys.is_org_member(org_id));
create policy "songs_insert_members" on overlaysys.songs
  for insert with check (overlaysys.is_org_member(org_id));
create policy "songs_update_members" on overlaysys.songs
  for update using (overlaysys.is_org_member(org_id));
create policy "songs_delete_members" on overlaysys.songs
  for delete using (overlaysys.is_org_member(org_id));

-- templates
create policy "templates_select_members" on overlaysys.templates
  for select using (overlaysys.is_org_member(org_id));
create policy "templates_insert_members" on overlaysys.templates
  for insert with check (overlaysys.is_org_member(org_id));
create policy "templates_update_members" on overlaysys.templates
  for update using (overlaysys.is_org_member(org_id));
create policy "templates_delete_members" on overlaysys.templates
  for delete using (overlaysys.is_org_member(org_id));

-- asset_index
create policy "asset_index_select_members" on overlaysys.asset_index
  for select using (overlaysys.is_org_member(org_id));
create policy "asset_index_insert_members" on overlaysys.asset_index
  for insert with check (overlaysys.is_org_member(org_id));
create policy "asset_index_delete_members" on overlaysys.asset_index
  for delete using (overlaysys.is_org_member(org_id));

-- ─── Storage bucket ─────────────────────────────────────────────────────────
--
-- Bucket `overlaysys-assets` holds content-addressed binaries. Object path
-- layout: <org_id>/<sha256>.<ext>. Named with the `overlaysys-` prefix so
-- other apps sharing this Supabase project don't collide.
--
-- The bucket is PUBLIC. We do this deliberately so `<img src=...>` and
-- `<video src=...>` work synchronously without preflighting signed URLs on
-- every render. Privacy lives in the path: both segments are practically
-- unguessable (org UUID + SHA-256 of file bytes). Listing the bucket still
-- requires auth, so the trade-off is "anyone who somehow obtained the URL
-- can read the file" — acceptable for show graphics, not for PHI/PII.
--
-- Writes and deletes are still org-scoped via RLS on storage.objects.

insert into storage.buckets (id, name, public)
  values ('overlaysys-assets', 'overlaysys-assets', true)
  on conflict (id) do update set public = excluded.public;

-- No SELECT policy — bucket is public.

create policy "overlaysys_assets_insert_members" on storage.objects
  for insert with check (
    bucket_id = 'overlaysys-assets'
    and overlaysys.is_org_member((storage.foldername(name))[1]::uuid)
  );

create policy "overlaysys_assets_delete_members" on storage.objects
  for delete using (
    bucket_id = 'overlaysys-assets'
    and overlaysys.is_org_member((storage.foldername(name))[1]::uuid)
  );

-- ─── updated_at triggers ────────────────────────────────────────────────────
--
-- Auto-bump updated_at on every UPDATE so the conflict-detection logic in
-- the Electron publish flow can compare "what I started from" vs "what
-- cloud has now" without the client having to remember to set the column.

create or replace function overlaysys.set_updated_at()
  returns trigger
  language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger projects_updated_at before update on overlaysys.projects
  for each row execute function overlaysys.set_updated_at();
create trigger shows_updated_at before update on overlaysys.shows
  for each row execute function overlaysys.set_updated_at();
create trigger hotcards_updated_at before update on overlaysys.hotcards
  for each row execute function overlaysys.set_updated_at();
create trigger songs_updated_at before update on overlaysys.songs
  for each row execute function overlaysys.set_updated_at();
create trigger templates_updated_at before update on overlaysys.templates
  for each row execute function overlaysys.set_updated_at();
