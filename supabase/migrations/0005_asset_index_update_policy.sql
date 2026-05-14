-- asset_index is upserted by the publish path so supabase-js sends an
-- `INSERT ... ON CONFLICT DO UPDATE` under the hood. Migration 0001 only
-- created select/insert/delete policies — the missing UPDATE policy
-- meant any re-upload of an asset (or upserts in general) were rejected
-- by RLS with "new row violates row-level security policy". This adds
-- the missing policy. Membership check matches the others on this table.

create policy "asset_index_update_members" on overlaysys.asset_index
  for update
  using (overlaysys.is_org_member(org_id))
  with check (overlaysys.is_org_member(org_id));
