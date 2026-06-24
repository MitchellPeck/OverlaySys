-- Soft-delete columns for every synced entity. The sync engine in
-- packages/core/src/syncEngine.ts propagates deletions via tombstones —
-- a row with `deleted_at` set on one replica overrides the other when
-- its `updated_at` is newer. Without this column on each table, a
-- hard-deleted record on one side would resurrect from the other on the
-- next sync pass.
--
-- channel_configs + project_channel_overrides already gained deleted_at
-- in 0008_channels.sql; this migration covers the original-init tables.
--
-- All adds are nullable + idempotent so re-running on a partially
-- migrated database is safe.

alter table overlaysys.projects add column if not exists deleted_at timestamptz;
alter table overlaysys.shows add column if not exists deleted_at timestamptz;
alter table overlaysys.hotcards add column if not exists deleted_at timestamptz;
alter table overlaysys.songs add column if not exists deleted_at timestamptz;
alter table overlaysys.templates add column if not exists deleted_at timestamptz;
