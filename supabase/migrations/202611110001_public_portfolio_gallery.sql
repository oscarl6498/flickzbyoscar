-- FLICKZ BY OSCAR — public portfolio gallery
-- Creates a separate public bucket for portfolio/event photos.
-- Do NOT change the existing flickz-gallery private client-delivery bucket.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'flickz-public-gallery',
  'flickz-public-gallery',
  true,
  20971520,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
set public = true,
    file_size_limit = 20971520,
    allowed_mime_types = array['image/jpeg','image/png','image/webp'];

-- The portfolio is public, so its object list must be readable by the public client
-- to build the event albums. This policy is scoped only to this public bucket.
drop policy if exists "Public can list FLICKZ portfolio photos" on storage.objects;
create policy "Public can list FLICKZ portfolio photos"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'flickz-public-gallery');

-- Only signed-in users can add portfolio photos.
drop policy if exists "Authenticated users can upload FLICKZ portfolio photos" on storage.objects;
create policy "Authenticated users can upload FLICKZ portfolio photos"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'flickz-public-gallery');
