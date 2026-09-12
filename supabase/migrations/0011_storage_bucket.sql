-- 0011_storage_bucket.sql
-- Create a public bucket for social broadcast images and assets
insert into storage.buckets (id, name, public)
values ('broadcast-images', 'broadcast-images', true)
on conflict (id) do update set public = true;

-- Allow public read access to broadcast-images
drop policy if exists "Public read broadcast-images" on storage.objects;
create policy "Public read broadcast-images" on storage.objects
    for select using (bucket_id = 'broadcast-images');

-- Allow authenticated admin users to upload images
drop policy if exists "Admin insert broadcast-images" on storage.objects;
create policy "Admin insert broadcast-images" on storage.objects
    for insert with check (bucket_id = 'broadcast-images' and public.is_admin());

-- Allow authenticated admin users to delete images
drop policy if exists "Admin delete broadcast-images" on storage.objects;
create policy "Admin delete broadcast-images" on storage.objects
    for delete using (bucket_id = 'broadcast-images' and public.is_admin());
