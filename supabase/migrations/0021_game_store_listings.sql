-- 0021_game_store_listings.sql
-- Store multi-lingual official store listings synced from Play Console (edits.listings)
create table if not exists public.game_store_listings (
  id text primary key,                     -- Format: '{game_id}:{language}' (e.g. 'com.MainraGames.Popit3DFidget:id-ID')
  game_id text not null references public.games (id) on delete cascade,
  language text not null,                  -- BCP-47 tag, e.g. 'id-ID', 'en-US', 'es-ES'
  title text not null,                     -- Max 30 chars (Google Play requirement)
  short_description text default '',       -- Max 80 chars
  full_description text default '',        -- Max 4000 chars
  video text,                              -- YouTube promo URL
  synced_at timestamptz not null default now()
);

create index if not exists game_store_listings_game_idx on public.game_store_listings (game_id);
create index if not exists game_store_listings_lang_idx on public.game_store_listings (language);

-- Also add store_listings map and short_description to public.games
alter table public.games
  add column if not exists short_description text,
  add column if not exists video_url text,
  add column if not exists store_listings jsonb default '{}'::jsonb;

-- Row Level Security
alter table public.game_store_listings enable row level security;

-- Public can read store listings in any language
drop policy if exists "store_listings public read" on public.game_store_listings;
create policy "store_listings public read" on public.game_store_listings
  for select
  using (true);

-- Only Admins can modify store listings
drop policy if exists "store_listings admin write" on public.game_store_listings;
create policy "store_listings admin write" on public.game_store_listings
  for all
  using (public.is_admin())
  with check (public.is_admin());
