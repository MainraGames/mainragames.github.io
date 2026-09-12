-- 0005_ratings_and_reviews_count.sql
alter table public.games add column if not exists "ratings_count" integer;
alter table public.games add column if not exists "reviews_count" integer;
