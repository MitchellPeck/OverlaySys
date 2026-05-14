-- Fix: storage policies on the overlaysys-assets bucket were rejecting
-- inserts for users who pass overlaysys.is_org_member on other tables.
-- Root cause: Supabase Storage evaluates policies in a context where the
-- SECURITY DEFINER helper sometimes fails to resolve cleanly. The
-- defensive fix is to drop any prior overlaysys_assets_* policies and
-- recreate them with `to authenticated`, inlining the membership lookup
-- against public.orgs.members so the policy is self-contained.

-- Drop every overlaysys_assets_* policy on storage.objects, regardless of
-- which migration created it (covers an early version that referenced a
-- since-dropped org_members table as well as the helper-based version).
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

-- Ensure the bucket exists and is public. Idempotent.
insert into storage.buckets (id, name, public)
  values ('overlaysys-assets', 'overlaysys-assets', true)
  on conflict (id) do update set public = excluded.public;

-- No SELECT policy — bucket is public, so reads bypass RLS entirely.
-- Path layout is `<org_id>/<sha256>.<ext>`; (org_id, sha) are both
-- unguessable in practice so leaking a URL just leaks that one object.

-- INSERT: caller's auth.uid() must appear in public.orgs.members for the
-- org whose UUID is the first path segment.
create policy "overlaysys_assets_insert_members" on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'overlaysys-assets'
    and exists (
      select 1
      from public.orgs o
      where o.id::text = (storage.foldername(name))[1]
        and (auth.uid()::text) = any(o.members)
    )
  );

-- UPDATE: same check on the existing row's org, and on the new row's org
-- (catches a malicious update that tries to move bytes into another org).
create policy "overlaysys_assets_update_members" on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'overlaysys-assets'
    and exists (
      select 1
      from public.orgs o
      where o.id::text = (storage.foldername(name))[1]
        and (auth.uid()::text) = any(o.members)
    )
  )
  with check (
    bucket_id = 'overlaysys-assets'
    and exists (
      select 1
      from public.orgs o
      where o.id::text = (storage.foldername(name))[1]
        and (auth.uid()::text) = any(o.members)
    )
  );

-- DELETE: same membership check.
create policy "overlaysys_assets_delete_members" on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'overlaysys-assets'
    and exists (
      select 1
      from public.orgs o
      where o.id::text = (storage.foldername(name))[1]
        and (auth.uid()::text) = any(o.members)
    )
  );

-- Storage RLS needs to be able to read public.orgs to evaluate the checks
-- above. apps-portal's public.orgs already has RLS that would block the
-- authenticated role; the storage policy needs raw select on the row to
-- check the members array, so grant SELECT on the columns it needs.
-- (apps-portal can revoke this for its own UI by writing a more
-- restrictive RLS policy on public.orgs that still allows membership-of-
-- self lookups.)
grant select (id, members) on public.orgs to authenticated;
