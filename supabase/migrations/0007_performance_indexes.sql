-- 0007_performance_indexes.sql
-- Optimizing query lookups for games sorting, featured flags, and composite review filters

create index if not exists games_sort_order_idx on public.games (sort_order, title);
create index if not exists games_featured_idx on public.games (featured) where featured = true;
create index if not exists game_reviews_game_ts_idx on public.game_reviews (game_id, review_timestamp desc);
create index if not exists game_reviews_rating_idx on public.game_reviews (star_rating);
