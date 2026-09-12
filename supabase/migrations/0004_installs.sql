-- Analytics support: Play Store install counts per game
alter table public.games add column if not exists "installs" text;
