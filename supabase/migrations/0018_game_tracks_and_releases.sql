-- 0018_game_tracks_and_releases.sql
-- Add tracks metadata to public.games to store live track rollout status & changelogs from Google Play Console
alter table public.games
    add column if not exists track_releases jsonb default '{}'::jsonb,
    add column if not exists active_version_name text,
    add column if not exists active_version_code text,
    add column if not exists rollout_status text,
    add column if not exists rollout_percentage integer,
    add column if not exists release_notes jsonb default '{}'::jsonb,
    add column if not exists tracks_synced_at timestamptz;

-- Add index on rollout_status for filtering
create index if not exists idx_games_rollout_status on public.games (rollout_status);
