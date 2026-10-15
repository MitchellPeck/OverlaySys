-- Two fixes to the project publish path, both of which only manifest
-- against a real Postgres — the in-memory fakes in syncEngine.test.ts
-- have neither a column list nor triggers.
--
-- 1. `song_custom_field_schema` had no column at all. ProjectSchema in
--    packages/core/src/project.ts has carried the field since the
--    custom-fields work, and three operator surfaces read it, but the
--    cloud table never gained a home for it. Publishing stripped it,
--    and because the stripped copy then looked newer (see 2), the next
--    pull wrote that stripped copy back over the local disk file —
--    destroying the operator's field schema for good.
--
-- 2. `set_updated_at()` unconditionally overwrote `updated_at` on every
--    UPDATE. That was correct for the original Electron publish flow,
--    where the trigger was the sole writer of the column and the client
--    only ever read it back for conflict detection. It is wrong for the
--    SyncEngine, which reconciles by last-writer-wins on a timestamp it
--    supplies itself: the trigger made every pushed row strictly newer
--    on the remote than the local copy it came from, so the very next
--    pass pulled it back down and logged an overwrite. Publish could
--    never converge — it ping-ponged on every cadence tick.
--
--    The fix keeps the auto-bump for writers that don't manage the
--    column (apps/operator/src/lib/cloudData.ts still omits it) while
--    honouring an explicit value when one is supplied. `is distinct
--    from` handles nulls without a special case.

alter table overlaysys.projects
  add column if not exists song_custom_field_schema jsonb;

create or replace function overlaysys.set_updated_at()
  returns trigger
  language plpgsql
as $$
begin
  -- Only stamp now() when the writer left updated_at alone. A client
  -- that sets it explicitly (the sync engine) owns the value, otherwise
  -- last-writer-wins can never settle.
  if new.updated_at is not distinct from old.updated_at then
    new.updated_at = now();
  end if;
  return new;
end;
$$;
