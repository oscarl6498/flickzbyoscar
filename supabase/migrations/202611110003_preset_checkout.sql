-- FLICKZ BY OSCAR — Stripe preset checkout and secure digital delivery
-- Run once in Supabase SQL Editor. Keeps preset files private.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('flickz-preset-files', 'flickz-preset-files', false, 104857600, array['application/zip'])
on conflict (id) do update
set public = false,
    file_size_limit = 104857600,
    allowed_mime_types = array['application/zip'];

create table if not exists public.flickz_preset_assets (
  product_key text primary key check (product_key in (
    'flicks-sports-preset-pack',
    'flicks-ultimate-preset-pack',
    'flicks-ultimate-preset-bundle'
  )),
  owner_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.flickz_preset_orders (
  id uuid primary key default gen_random_uuid(),
  stripe_checkout_session_id text not null unique,
  owner_id uuid not null references auth.users(id),
  product_key text not null check (product_key in (
    'flicks-sports-preset-pack',
    'flicks-ultimate-preset-pack',
    'flicks-ultimate-preset-bundle'
  )),
  buyer_email text,
  amount_total integer not null,
  currency text not null default 'usd',
  payment_status text not null default 'paid',
  created_at timestamptz not null default now()
);

create index if not exists flickz_preset_orders_owner_created_idx
  on public.flickz_preset_orders(owner_id, created_at desc);

alter table public.flickz_preset_assets enable row level security;
alter table public.flickz_preset_orders enable row level security;

revoke all on public.flickz_preset_assets from anon, authenticated;
revoke all on public.flickz_preset_orders from anon, authenticated;
grant select, insert, update, delete on public.flickz_preset_assets to authenticated;
grant select on public.flickz_preset_orders to authenticated;

drop policy if exists "Store owner manages preset assets" on public.flickz_preset_assets;
create policy "Store owner manages preset assets"
on public.flickz_preset_assets
for all
to authenticated
using (
  owner_id = (select auth.uid())
  and exists (select 1 from public.flickz_albums a where a.owner_id = (select auth.uid()))
)
with check (
  owner_id = (select auth.uid())
  and exists (select 1 from public.flickz_albums a where a.owner_id = (select auth.uid()))
);

drop policy if exists "Store owner views preset orders" on public.flickz_preset_orders;
create policy "Store owner views preset orders"
on public.flickz_preset_orders
for select
to authenticated
using (owner_id = (select auth.uid()));

-- A logged-in owner can manage only their own private ZIP objects.
drop policy if exists "Preset owner can select own private ZIPs" on storage.objects;
create policy "Preset owner can select own private ZIPs"
on storage.objects for select to authenticated
using (
  bucket_id = 'flickz-preset-files'
  and split_part(name, '/', 1) = (select auth.uid())::text
  and exists (
    select 1 from public.flickz_albums a
    where a.owner_id = (select auth.uid())
  )
);

drop policy if exists "Preset owner can upload own private ZIPs" on storage.objects;
create policy "Preset owner can upload own private ZIPs"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'flickz-preset-files'
  and split_part(name, '/', 1) = (select auth.uid())::text
  and exists (
    select 1 from public.flickz_albums a
    where a.owner_id = (select auth.uid())
  )
);

drop policy if exists "Preset owner can delete own private ZIPs" on storage.objects;
create policy "Preset owner can delete own private ZIPs"
on storage.objects for delete to authenticated
using (
  bucket_id = 'flickz-preset-files'
  and split_part(name, '/', 1) = (select auth.uid())::text
  and exists (
    select 1 from public.flickz_albums a
    where a.owner_id = (select auth.uid())
  )
);
