-- 0020_game_inapp_products.sql
-- Table to store In-App Products (IAP) & items catalog synced from Google Play Console
create table if not exists public.game_inapp_products (
  id text primary key,                     -- Format: '{game_id}:{sku}'
  game_id text not null references public.games (id) on delete cascade,
  sku text not null,
  status text not null default 'active',   -- 'active' | 'inactive'
  purchase_type text not null default 'managedUser', -- 'managedUser' (one-time) | 'subscription'
  title text not null,
  description text default '',
  price_micros text,                       -- Micro-units (e.g. 15000000000)
  currency text default 'IDR',
  formatted_price text,                    -- Human-readable default price (e.g. 'Rp 15.000')
  prices jsonb default '{}'::jsonb,        -- Region prices map (ISO 3166-2: { priceMicros, currency })
  listings jsonb default '{}'::jsonb,      -- Multi-lingual titles & descriptions (e.g. 'en-US', 'id-ID')
  default_language text default 'en-US',
  raw_payload jsonb,
  synced_at timestamptz not null default now()
);

create index if not exists inapp_products_game_idx on public.game_inapp_products (game_id);
create index if not exists inapp_products_sku_idx on public.game_inapp_products (sku);
create index if not exists inapp_products_status_idx on public.game_inapp_products (status);

-- Row Level Security
alter table public.game_inapp_products enable row level security;

-- Public can view active in-app products to showcase in-game store on website
drop policy if exists "inapp_products public read" on public.game_inapp_products;
create policy "inapp_products public read" on public.game_inapp_products
  for select
  using (status = 'active' or public.is_admin());

-- Admin & Service Role can manage catalog
drop policy if exists "inapp_products admin write" on public.game_inapp_products;
create policy "inapp_products admin write" on public.game_inapp_products
  for all
  using (public.is_admin())
  with check (public.is_admin());
