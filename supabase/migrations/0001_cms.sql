-- Mainra Games CMS schema (Supabase project: mjuzjvyatunjmgaiqtdv)
-- Applied via: supabase db query --linked -f supabase/migrations/0001_cms.sql

-- Games content (mirrors Assets/data/games-data.json shape)
create table if not exists public.games (
  id text primary key,                 -- package name, e.g. com.MainraGames.Popit3DFidget
  title text not null,
  description text not null default '',
  image text not null default '',
  screenshots jsonb not null default '[]'::jsonb,
  "playLink" text not null default '',
  category text not null default 'Casual',
  status text not null default 'Released',
  "releaseDate" date,
  featured boolean not null default false,
  platform text not null default 'Android',
  rating double precision,
  "appId" text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Key/value site settings (highlight.gameId, customTitle, customDescription, youtubeUrl, stats, active)
create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Admin allowlist
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

-- Play Store reviews (and manual entries) with reply state
create table if not exists public.game_reviews (
  review_id text primary key,          -- Google Play review id, or 'local-<uuid>' when manual
  game_id text references public.games (id) on delete set null,
  author_name text not null default 'Anonymous',
  content text not null default '',
  star_rating integer check (star_rating between 1 and 5),
  "versionCode" text,
  device text,
  review_timestamp bigint,             -- epoch millis from Play
  lang text,
  source text not null default 'playstore' check (source in ('playstore','manual')),
  reply_text text,
  reply_timestamp bigint,
  synced_at timestamptz not null default now()
);

create index if not exists game_reviews_game_idx on public.game_reviews (game_id);
create index if not exists game_reviews_ts_idx on public.game_reviews (review_timestamp desc nulls last);

-- updated_at triggers
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists games_touch_updated on public.games;
create trigger games_touch_updated before update on public.games
for each row execute function public.touch_updated_at();

drop trigger if exists site_settings_touch_updated on public.site_settings;
create trigger site_settings_touch_updated before update on public.site_settings
for each row execute function public.touch_updated_at();

-- Admin check helper (security definer to avoid RLS recursion on admin_users)
create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select (select count(*) from public.admin_users) = 0
     or exists (select 1 from public.admin_users a where a.user_id = auth.uid());
$$;

-- Row Level Security
alter table public.games enable row level security;
alter table public.site_settings enable row level security;
alter table public.admin_users enable row level security;
alter table public.game_reviews enable row level security;

drop policy if exists "games public read" on public.games;
create policy "games public read" on public.games
  for select using (true);

drop policy if exists "games admin write" on public.games;
create policy "games admin write" on public.games
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "site_settings public read" on public.site_settings;
create policy "site_settings public read" on public.site_settings
  for select using (true);

drop policy if exists "site_settings admin write" on public.site_settings;
create policy "site_settings admin write" on public.site_settings
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "reviews admin all" on public.game_reviews;
create policy "reviews admin all" on public.game_reviews
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin_users self read" on public.admin_users;
create policy "admin_users self read" on public.admin_users
  for select using (public.is_admin());

drop policy if exists "admin_users admin write" on public.admin_users;
create policy "admin_users admin write" on public.admin_users
  for all using (public.is_admin()) with check (public.is_admin());

-- Realtime for dashboard liveness
do $$ begin
  begin
    alter publication supabase_realtime add table public.games;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.game_reviews;
  exception when duplicate_object then null;
  end;
end $$;
