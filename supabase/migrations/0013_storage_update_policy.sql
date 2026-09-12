-- 0013_storage_update_policy.sql
-- Add UPDATE and UPSERT policies for broadcast-images bucket in storage.objects
alter table storage.objects enable row level security;

drop policy if exists "Admin update broadcast-images" on storage.objects;
create policy "Admin update broadcast-images" on storage.objects
    for update using (bucket_id = 'broadcast-images' and public.is_admin())
    with check (bucket_id = 'broadcast-images' and public.is_admin());
