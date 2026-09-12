-- supabase/migrations/0017_secure_site_settings_rls.sql
-- Restrict public read access to non-sensitive site settings only.
-- Sensitive settings like 'gemini_api_key' and credentials can only be read by authenticated admins or service_role.

drop policy if exists "site_settings public read" on public.site_settings;

create policy "site_settings public read" on public.site_settings
  for select
  using (
    key not in ('gemini_api_key', 'google_service_account', 'gemini_keys')
    or is_admin()
  );
