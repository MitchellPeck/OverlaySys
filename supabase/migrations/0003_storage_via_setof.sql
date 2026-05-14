-- Fix (again): storage RLS still rejects asset uploads even with the
-- inlined membership check from 0002. Root cause: apps-portal's
-- `public.orgs` has RLS enabled without a SELECT policy that authenticated
-- users can use to read their own row, so the subquery in 0002's
-- inlined check returns 0 rows.
--
-- The robust fix is a SECURITY DEFINER function that returns the set of
-- org UUIDs the current user belongs to. Defined as a set-returning
-- function (not a boolean) so the storage policy can phrase the check as
-- `IN (select * from overlaysys.my_orgs())` — Supabase's storage policy
-- documentation consistently uses this shape and it works reliably.

create or replace function overlaysys.my_orgs()
  returns setof uuid
  language sql
  stable
  security definer
  set search_path = public
as $$
  select id
  from public.orgs
  where auth.uid() is not null
    and (auth.uid()::text) = any(members);
$$;

grant execute on function overlaysys.my_orgs() to authenticated;
grant execute on function overlaysys.my_orgs() to service_role;

-- Wipe any prior overlaysys_assets_* policy variants so we start clean.
do $$
declare
  pol record;
begin
  for pol in
    select polname from pg_policy
    where polrelid = 'storage.objects'::regclass
      and polname like 'overlaysys_assets_%'
  loop
    execute format('drop policy if exists %I on storage.objects', pol.polname);
  end loop;
end$$;

-- INSERT: caller must be a member of the org named by the first path
-- segment. Path layout is `<org_id>/<sha256>.<ext>`.
create policy "overlaysys_assets_insert_members" on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'overlaysys-assets'
    and (storage.foldername(name))[1]::uuid in (
      select id from overlaysys.my_orgs() as id
    )
  );

-- UPDATE: both the existing row and any rewrite target stay in the same
-- org. Catches a hypothetical attempt to move bytes across orgs.
create policy "overlaysys_assets_update_members" on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'overlaysys-assets'
    and (storage.foldername(name))[1]::uuid in (
      select id from overlaysys.my_orgs() as id
    )
  )
  with check (
    bucket_id = 'overlaysys-assets'
    and (storage.foldername(name))[1]::uuid in (
      select id from overlaysys.my_orgs() as id
    )
  );

-- DELETE: membership check.
create policy "overlaysys_assets_delete_members" on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'overlaysys-assets'
    and (storage.foldername(name))[1]::uuid in (
      select id from overlaysys.my_orgs() as id
    )
  );

-- No SELECT policy — the bucket is public so reads bypass RLS entirely.
-- The path layout (org UUID + content-addressed SHA) is unguessable
-- enough that public reads are acceptable for this app.

-- Note: 0002 added `grant select (id, members) on public.orgs to
-- authenticated` to make its inlined approach work. That grant is
-- harmless after this migration but no longer necessary — the
-- SECURITY DEFINER function reads as its owner, bypassing public.orgs RLS.
-- Leaving the grant in place doesn't expose anything the function
-- doesn't already expose via `my_orgs()`, so we don't revoke.
