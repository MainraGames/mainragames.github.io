-- Track which replies have already been posted to Google Play by the sync job.
alter table public.game_reviews add column if not exists "replySentAt" timestamptz;
