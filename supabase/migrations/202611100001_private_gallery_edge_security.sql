-- FLICKZ BY OSCAR: secure private-gallery edge-function support
-- Run once in Supabase Dashboard > SQL Editor after the original gallery tables exist.
-- This migration keeps the bucket private and adds a database-backed rate limiter.

update storage.buckets set public = false where id = 'flickz-gallery';

create table if not exists public.flickz_gallery_rate_limits (
  key_hash text primary key,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0
);
alter table public.flickz_gallery_rate_limits enable row level security;
revoke all on public.flickz_gallery_rate_limits from anon, authenticated;
grant all on public.flickz_gallery_rate_limits to service_role;

create or replace function public.flickz_consume_gallery_attempt(p_key_hash text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare current_attempts integer;
begin
  insert into public.flickz_gallery_rate_limits(key_hash, window_started_at, attempts)
  values (p_key_hash, now(), 1)
  on conflict (key_hash) do update
    set window_started_at = case
          when now() - flickz_gallery_rate_limits.window_started_at >= interval '15 minutes' then now()
          else flickz_gallery_rate_limits.window_started_at end,
        attempts = case
          when now() - flickz_gallery_rate_limits.window_started_at >= interval '15 minutes' then 1
          else flickz_gallery_rate_limits.attempts + 1 end
  returning attempts into current_attempts;
  return current_attempts <= 25;
end;
$$;

revoke all on function public.flickz_consume_gallery_attempt(text) from public, anon, authenticated;
grant execute on function public.flickz_consume_gallery_attempt(text) to service_role;

-- The browser no longer calls these legacy SECURITY DEFINER functions directly.
revoke all on function public.flickz_lookup_gallery(text) from public, anon, authenticated;
revoke all on function public.flickz_submit_selection(text, uuid[], boolean) from public, anon, authenticated;

-- Explicitly remove any legacy public-read policy left over from the first setup attempt.
drop policy if exists "Public can view gallery files" on storage.objects;
drop policy if exists "Anyone can view gallery files" on storage.objects;


-- Photographer review state: permission and approval remain separate.
alter table public.flickz_selections
  add column if not exists instagram_approved boolean not null default false;
