-- storage.buckets has RLS enabled by default but no policies, so
-- authenticated users can't even SELECT the row that describes the
-- bucket they're trying to upload to. Supabase storage-api needs to
-- read storage.buckets before evaluating object-level policies; when
-- that read returns zero rows, the upload fails with a generic
-- "row-level security policy" error that LOOKS like an object-level
-- problem but is actually bucket-visibility.
--
-- Symptom in the wild: every storage operation (including with a fully
-- unrestricted storage.objects policy, and even with RLS disabled on
-- storage.objects) returns 403 with the RLS message. Disabling RLS on
-- the wrong table doesn't help because storage.buckets is the one
-- actually gating access.
--
-- Fix: a SELECT policy on storage.buckets that lets any authenticated
-- user see our bucket row. The bucket's `public = true` flag plus the
-- existing object-level membership check still scope what they can
-- actually read/write inside the bucket — visibility is not access.

create policy "overlaysys_bucket_select" on storage.buckets
  for select
  using (id = 'overlaysys-assets');
