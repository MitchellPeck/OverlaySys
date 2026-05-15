-- Channels are now first-class org data, parallel to songs/templates.
-- The cloud is the source of truth; paired devices pull this configuration
-- on sync. Per-project overrides patch individual channels for specific
-- projects without forking the org defaults — see
-- packages/core/src/channelResolution.ts for the cascade semantics.
--
-- These tables intentionally use a jsonb payload (matching songs/templates)
-- rather than per-field columns so the schema can evolve without migrations
-- as ChannelConfig fields are added.

-- ─── channel_configs (org library) ───────────────────────────────────────

create table overlaysys.channel_configs (
  id text not null,
  org_id uuid not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (org_id, id)
);

create trigger channel_configs_updated_at before update on overlaysys.channel_configs
  for each row execute function overlaysys.set_updated_at();

alter table overlaysys.channel_configs enable row level security;

create policy "channel_configs_select_members" on overlaysys.channel_configs
  for select using (overlaysys.is_org_member(org_id));
create policy "channel_configs_insert_members" on overlaysys.channel_configs
  for insert with check (overlaysys.is_org_member(org_id));
create policy "channel_configs_update_members" on overlaysys.channel_configs
  for update using (overlaysys.is_org_member(org_id));
create policy "channel_configs_delete_members" on overlaysys.channel_configs
  for delete using (overlaysys.is_org_member(org_id));

-- ─── project_channel_overrides (per-project patches) ─────────────────────

create table overlaysys.project_channel_overrides (
  org_id uuid not null,
  project_id text not null,
  channel_id text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (org_id, project_id, channel_id)
);

create trigger project_channel_overrides_updated_at before update on overlaysys.project_channel_overrides
  for each row execute function overlaysys.set_updated_at();

alter table overlaysys.project_channel_overrides enable row level security;

create policy "project_channel_overrides_select_members" on overlaysys.project_channel_overrides
  for select using (overlaysys.is_org_member(org_id));
create policy "project_channel_overrides_insert_members" on overlaysys.project_channel_overrides
  for insert with check (overlaysys.is_org_member(org_id));
create policy "project_channel_overrides_update_members" on overlaysys.project_channel_overrides
  for update using (overlaysys.is_org_member(org_id));
create policy "project_channel_overrides_delete_members" on overlaysys.project_channel_overrides
  for delete using (overlaysys.is_org_member(org_id));
