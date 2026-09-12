-- 0008_social_broadcasts.sql
-- Table to track news & social media updates broadcasted via Buffer or local CMS

create table if not exists public.social_broadcasts (
    id uuid primary key default gen_random_uuid(),
    title text not null,
    content text not null,
    image_url text,
    target_link text,
    channels jsonb default '[]'::jsonb,
    buffer_updates jsonb default '[]'::jsonb,
    status text default 'published',
    published_at timestamptz default timezone('utc'::text, now()),
    created_by uuid references auth.users(id) on delete set null
);

alter table public.social_broadcasts enable row level security;

-- Public can read published broadcasts (for latest studio news on website)
drop policy if exists "social_broadcasts public read" on public.social_broadcasts;
create policy "social_broadcasts public read" on public.social_broadcasts
    for select using (status = 'published');

-- Admins can create/edit/delete broadcasts
drop policy if exists "social_broadcasts admin write" on public.social_broadcasts;
create policy "social_broadcasts admin write" on public.social_broadcasts
    for all using (public.is_admin()) with check (public.is_admin());
