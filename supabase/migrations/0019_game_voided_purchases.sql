-- 0019_game_voided_purchases.sql
-- Table to store canceled, refunded, or charged-back transactions from Google Play Console
create table if not exists public.game_voided_purchases (
  order_id text primary key,               -- Google Play Order ID (e.g. GPA.1234-5678-9012-34567)
  game_id text references public.games (id) on delete cascade,
  purchase_token text not null,
  purchase_time_millis bigint,             -- epoch millis of original purchase
  voided_time_millis bigint,               -- epoch millis when refunded / voided
  voided_source integer,                   -- 0: User, 1: Developer, 2: Google
  voided_source_label text,
  voided_reason integer,                   -- 0: Other, 1: Remorse, 4: Accidental, 5: Fraud, 6: Friendly Fraud, 7: Chargeback, 8: Unacknowledged
  voided_reason_label text,
  voided_quantity integer default 1,
  is_fraud_or_chargeback boolean default false,
  raw_payload jsonb,
  synced_at timestamptz not null default now()
);

create index if not exists voided_purchases_game_idx on public.game_voided_purchases (game_id);
create index if not exists voided_purchases_voided_time_idx on public.game_voided_purchases (voided_time_millis desc nulls last);
create index if not exists voided_purchases_fraud_idx on public.game_voided_purchases (is_fraud_or_chargeback);

-- Row Level Security
alter table public.game_voided_purchases enable row level security;

-- Financial transaction records are strictly restricted to admin users & service role only
drop policy if exists "voided_purchases admin read" on public.game_voided_purchases;
create policy "voided_purchases admin read" on public.game_voided_purchases
  for select using (public.is_admin());

drop policy if exists "voided_purchases admin write" on public.game_voided_purchases;
create policy "voided_purchases admin write" on public.game_voided_purchases
  for all using (public.is_admin()) with check (public.is_admin());
