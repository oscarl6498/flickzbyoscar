-- FLICKZ BY OSCAR — public portfolio album manager
-- Run once in Supabase SQL Editor.
-- This creates a separate PUBLIC bucket for website portfolio photos.
-- The private client-delivery bucket named flickz-gallery remains private and unchanged.

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

create table if not exists public.flickz_public_albums (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 100),
  description text not null default '',
  category text not null default 'football' check (category in ('football','basketball','other')),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.flickz_public_photos (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.flickz_public_albums(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists flickz_public_albums_public_order_idx
  on public.flickz_public_albums(is_active, sort_order, created_at);
create index if not exists flickz_public_photos_album_order_idx
  on public.flickz_public_photos(album_id, sort_order, created_at);
create index if not exists flickz_public_photos_owner_idx
  on public.flickz_public_photos(owner_id);

alter table public.flickz_public_albums enable row level security;
alter table public.flickz_public_photos enable row level security;

revoke all on public.flickz_public_albums from anon, authenticated;
revoke all on public.flickz_public_photos from anon, authenticated;
grant select on public.flickz_public_albums to anon, authenticated;
grant insert, select, update, delete on public.flickz_public_albums to authenticated;
grant select on public.flickz_public_photos to anon, authenticated;
grant insert, select, update, delete on public.flickz_public_photos to authenticated;

drop policy if exists "Public can view active FLICKZ public albums" on public.flickz_public_albums;
create policy "Public can view active FLICKZ public albums"
on public.flickz_public_albums
for select
to anon, authenticated
using (is_active = true);

drop policy if exists "Owners can manage FLICKZ public albums" on public.flickz_public_albums;
create policy "Owners can manage FLICKZ public albums"
on public.flickz_public_albums
for all
to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

drop policy if exists "Public can view photos in active FLICKZ albums" on public.flickz_public_photos;
create policy "Public can view photos in active FLICKZ albums"
on public.flickz_public_photos
for select
to anon, authenticated
using (
  exists (
    select 1 from public.flickz_public_albums a
    where a.id = album_id and a.is_active = true
  )
);

drop policy if exists "Owners can manage photos in their FLICKZ albums" on public.flickz_public_photos;
create policy "Owners can manage photos in their FLICKZ albums"
on public.flickz_public_photos
for all
to authenticated
using (
  owner_id = (select auth.uid())
  and exists (
    select 1 from public.flickz_public_albums a
    where a.id = album_id and a.owner_id = (select auth.uid())
  )
)
with check (
  owner_id = (select auth.uid())
  and exists (
    select 1 from public.flickz_public_albums a
    where a.id = album_id and a.owner_id = (select auth.uid())
  )
);

-- Storage object listing is enabled only for the dedicated public portfolio bucket.
drop policy if exists "Public can list FLICKZ portfolio photos" on storage.objects;
create policy "Public can list FLICKZ portfolio photos"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'flickz-public-gallery');

-- Upload paths are user_id/album_id/file. Only that album's owner can add or delete objects.
drop policy if exists "Owners can upload FLICKZ public portfolio photos" on storage.objects;
create policy "Owners can upload FLICKZ public portfolio photos"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'flickz-public-gallery'
  and split_part(name, '/', 1) = (select auth.uid())::text
  and exists (
    select 1 from public.flickz_public_albums a
    where a.id::text = split_part(name, '/', 2)
      and a.owner_id = (select auth.uid())
  )
);

drop policy if exists "Owners can delete FLICKZ public portfolio photos" on storage.objects;
create policy "Owners can delete FLICKZ public portfolio photos"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'flickz-public-gallery'
  and split_part(name, '/', 1) = (select auth.uid())::text
  and exists (
    select 1 from public.flickz_public_albums a
    where a.id::text = split_part(name, '/', 2)
      and a.owner_id = (select auth.uid())
  )
);
