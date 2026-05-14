-- 0003 used `RETURNS SETOF uuid`, which produces a column with an
-- auto-generated name (usually the function name itself). The policies'
-- `id(id)` table+column rename worked in some contexts but not inside
-- the IN clause, where PostgreSQL resolved `id` to the row alias (a
-- record) rather than the column. The IN comparison then ran
-- `uuid IN (record)` and silently returned false, so RLS denied every
-- asset upload.
--
-- Fix: define the function with `RETURNS TABLE (org_id uuid)` so the
-- output column has an explicit, named projection. Policies select
-- `org_id` directly — no aliasing tricks, no ambiguity.

create or replace function overlaysys.my_orgs()
  returns table (org_id uuid)
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

-- Drop any prior overlaysys_assets_* policy variants and rebuild.
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

create policy "overlaysys_assets_insert_members" on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'overlaysys-assets'
    and (storage.foldername(name))[1]::uuid in (
      select org_id from overlaysys.my_orgs()
    )
  );

create policy "overlaysys_assets_update_members" on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'overlaysys-assets'
    and (storage.foldername(name))[1]::uuid in (
      select org_id from overlaysys.my_orgs()
    )
  )
  with check (
    bucket_id = 'overlaysys-assets'
    and (storage.foldername(name))[1]::uuid in (
      select org_id from overlaysys.my_orgs()
    )
  );

create policy "overlaysys_assets_delete_members" on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'overlaysys-assets'
    and (storage.foldername(name))[1]::uuid in (
      select org_id from overlaysys.my_orgs()
    )
  );
