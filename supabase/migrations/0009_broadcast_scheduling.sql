-- 0009_broadcast_scheduling.sql
-- Add scheduled_at column and indexes for content scheduling & calendar
alter table public.social_broadcasts 
    add column if not exists scheduled_at timestamptz;

create index if not exists social_broadcasts_scheduled_idx 
    on public.social_broadcasts (scheduled_at);

create index if not exists social_broadcasts_status_idx 
    on public.social_broadcasts (status);
