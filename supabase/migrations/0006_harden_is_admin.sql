-- 0006_harden_is_admin.sql
-- Security hardening: Remove the initial bootstrap fallback (count(*) = 0)
-- from public.is_admin(). Access to admin capabilities is now strictly restricted
-- to users explicitly present in public.admin_users.

create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.admin_users a 
    where a.user_id = auth.uid()
  );
$$;
