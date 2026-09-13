-- 0023_game_conversion_and_purchase_verification.sql
-- Store Listing Acquisition & Conversion Metrics and Server-Side Purchase Verifications

-- 1. Table for Store Listing Conversion Rates (from Play Developer Reporting API)
create table if not exists public.game_conversion_metrics (
  id text primary key, -- composite: {game_id}:{date}:{country}:{traffic_source}
  game_id text not null references public.games (id) on delete cascade,
  metric_date date not null default current_date,
  country text not null default 'GLOBAL',
  traffic_source text not null default 'ALL',
  visitors integer not null default 0,
  acquisitions integer not null default 0,
  conversion_rate double precision not null default 0.0,
  synced_at timestamptz not null default now()
);

create index if not exists idx_game_conversion_metrics_game on public.game_conversion_metrics (game_id);
create index if not exists idx_game_conversion_metrics_date on public.game_conversion_metrics (metric_date);

alter table public.game_conversion_metrics enable row level security;

drop policy if exists "conversion_metrics admin read" on public.game_conversion_metrics;
create policy "conversion_metrics admin read" on public.game_conversion_metrics
  for select
  using (public.is_admin());

drop policy if exists "conversion_metrics admin write" on public.game_conversion_metrics;
create policy "conversion_metrics admin write" on public.game_conversion_metrics
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- Add high-level conversion snapshot columns to games table
alter table public.games
  add column if not exists conversion_visitors integer default 0,
  add column if not exists conversion_acquisitions integer default 0,
  add column if not exists conversion_rate double precision default 0.0,
  add column if not exists conversion_synced_at timestamptz;

-- 2. Table for Server-Side In-App Purchase Verifications & Acknowledgments
create table if not exists public.game_purchase_verifications (
  purchase_token text primary key,
  game_id text not null references public.games (id) on delete cascade,
  product_id text not null,
  order_id text,
  status text not null default 'VALID', -- VALID, CANCELED, PENDING
  is_acknowledged boolean not null default false,
  purchase_time_millis bigint,
  consumption_state text default 'UNCONSUMED',
  verified_at timestamptz not null default now(),
  acknowledged_at timestamptz
);

create index if not exists idx_purchase_verifications_game on public.game_purchase_verifications (game_id);
create index if not exists idx_purchase_verifications_status on public.game_purchase_verifications (status);

alter table public.game_purchase_verifications enable row level security;

drop policy if exists "purchase_verifications admin read" on public.game_purchase_verifications;
create policy "purchase_verifications admin read" on public.game_purchase_verifications
  for select
  using (public.is_admin());

drop policy if exists "purchase_verifications admin write" on public.game_purchase_verifications;
create policy "purchase_verifications admin write" on public.game_purchase_verifications
  for all
  using (public.is_admin())
  with check (public.is_admin());
