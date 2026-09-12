-- 0010_contact_messages.sql
-- Table for storing incoming inquiries and messages from the public website contact form
create table if not exists public.contact_messages (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    email text not null,
    subject text,
    message text not null,
    status text default 'unread', -- 'unread', 'read', 'replied', 'archived'
    reply_notes text,
    created_at timestamptz default timezone('utc'::text, now()),
    updated_at timestamptz default timezone('utc'::text, now())
);

alter table public.contact_messages enable row level security;

-- 1. Public can submit new messages (Insert-only)
drop policy if exists "contact_messages public insert" on public.contact_messages;
create policy "contact_messages public insert" on public.contact_messages
    for insert with check (true);

-- 2. Only registered admins can read, update status, and delete messages
drop policy if exists "contact_messages admin full access" on public.contact_messages;
create policy "contact_messages admin full access" on public.contact_messages
    for all using (public.is_admin()) with check (public.is_admin());

-- Performance indexes
create index if not exists contact_messages_status_idx on public.contact_messages (status);
create index if not exists contact_messages_created_idx on public.contact_messages (created_at desc);
