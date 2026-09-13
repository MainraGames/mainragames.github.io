-- 0022_game_vitals_metrics.sql
-- Table to store Android Vitals metrics (Crash Rate, ANR Rate, Google Play thresholds)
-- Fetched via Google Play Developer Reporting API (playdeveloperreporting.googleapis.com)
create table if not exists public.game_vitals_metrics (
  game_id text primary key references public.games (id) on delete cascade,
  crash_rate double precision,               -- e.g. 0.0042 (0.42%)
  anr_rate double precision,                 -- e.g. 0.0015 (0.15%)
  crash_rate_7d double precision,
  anr_rate_7d double precision,
  distinct_users integer,
  health_status text default 'healthy' check (health_status in ('healthy', 'warning', 'critical')),
  health_message text default '',
  crash_near_threshold boolean default false,
  anr_near_threshold boolean default false,
  crash_exceeded_threshold boolean default false,
  anr_exceeded_threshold boolean default false,
  raw_metrics jsonb default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

-- Also add vitals summary columns to public.games for high-performance dashboard listing
alter table public.games
  add column if not exists vitals_crash_rate double precision,
  add column if not exists vitals_anr_rate double precision,
  add column if not exists vitals_health_status text default 'healthy';

-- Row Level Security
alter table public.game_vitals_metrics enable row level security;

-- Only Admins can view or manage detailed internal vitals metrics
drop policy if exists "vitals admin read" on public.game_vitals_metrics;
create policy "vitals admin read" on public.game_vitals_metrics
  for select
  using (public.is_admin());

drop policy if exists "vitals admin write" on public.game_vitals_metrics;
create policy "vitals admin write" on public.game_vitals_metrics
  for all
  using (public.is_admin())
  with check (public.is_admin());
