-- Storage RLS still rejected with 403 even with a wide-open
-- `to authenticated with check (bucket_id = 'overlaysys-assets')`
-- policy. Symptom of storage-api not calling `SET ROLE authenticated`
-- before the INSERT runs — PostgreSQL evaluates `to <role>` against the
-- session role, not the JWT claim. With session role stuck at whatever
-- storage-api uses (probably `service_role` or `supabase_storage_admin`),
-- policies tagged `to authenticated` are invisible.
--
-- Fix: drop the role restriction. The membership check via
-- overlaysys.my_orgs() (which reads auth.uid() from the JWT claims) is
-- what actually enforces org scoping — the role gate added no security
-- and was blocking the policy from firing.

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
  with check (
    bucket_id = 'overlaysys-assets'
    and (storage.foldername(name))[1]::uuid in (
      select org_id from overlaysys.my_orgs()
    )
  );

create policy "overlaysys_assets_update_members" on storage.objects
  for update
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
  using (
    bucket_id = 'overlaysys-assets'
    and (storage.foldername(name))[1]::uuid in (
      select org_id from overlaysys.my_orgs()
    )
  );

-- No SELECT policy — the bucket is public, reads bypass RLS entirely.
