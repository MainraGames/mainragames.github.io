-- 0012_review_device_metadata.sql
-- Add detailed device specifications & metadata to game_reviews table
alter table public.game_reviews
    add column if not exists device_name text,
    add column if not exists android_os_version integer,
    add column if not exists app_version_code integer,
    add column if not exists app_version_name text,
    add column if not exists thumbs_up_count integer default 0,
    add column if not exists thumbs_down_count integer default 0,
    add column if not exists device_metadata jsonb;
