-- 0025_harden_review_queue_and_contact.sql
-- Security hardening for the 5-star review queue and the public contact form.
-- Fixes P0-2 (pgmq RPC helpers callable by anon) and P2-10 (contact form has no
-- server-side rate limit and trusted a client-supplied created_at) from
-- AUDIT-mainragames-2026-09-14.md.

-- ---------------------------------------------------------------------------
-- 1. Lock down the pgmq RPC helpers
--
-- Postgres grants EXECUTE on new functions to PUBLIC by default, and `public`
-- is exposed to PostgREST (config.toml: schemas = ["public", "graphql_public"]).
-- Every SECURITY DEFINER helper below was therefore reachable as
-- POST /rest/v1/rpc/<name> by the anon role: read_review_queue exposed queued
-- review bodies and reviewer names, delete_review_queue let anyone drop pending
-- reply jobs.
-- ---------------------------------------------------------------------------

revoke execute on function public.read_review_queue(integer, integer) from public, anon, authenticated;
revoke execute on function public.archive_review_queue(bigint) from public, anon, authenticated;
revoke execute on function public.delete_review_queue(bigint) from public, anon, authenticated;
revoke execute on function public.trigger_process_review_queue() from public, anon, authenticated;

-- The worker reaches these through its service-role client, so re-grant there only.
grant execute on function public.read_review_queue(integer, integer) to service_role;
grant execute on function public.archive_review_queue(bigint) to service_role;
grant execute on function public.delete_review_queue(bigint) to service_role;
grant execute on function public.trigger_process_review_queue() to service_role;

-- Pin search_path so a caller cannot shadow pgmq/net with a schema of its own.
-- Bodies reference pgmq.* and net.* already-qualified, so an empty path is safe.
alter function public.read_review_queue(integer, integer) set search_path = '';
alter function public.archive_review_queue(bigint) set search_path = '';
alter function public.delete_review_queue(bigint) set search_path = '';
alter function public.trigger_process_review_queue() set search_path = '';
alter function public.enqueue_5star_review_for_reply() set search_path = '';

-- ---------------------------------------------------------------------------
-- 2. Shared secret, so the worker can tell the database apart from the internet
--
-- process-review-queue is deployed with --no-verify-jwt and spends Gemini quota
-- and posts replies to Google Play on the owner's behalf. It previously had no
-- caller check at all.
-- ---------------------------------------------------------------------------

insert into public.site_settings (key, value)
values ('review_queue_secret', to_jsonb(replace(gen_random_uuid()::text, '-', '')))
on conflict (key) do nothing;

-- Re-issue the public read policy (same rule as 0017) with the new secret hidden.
drop policy if exists "site_settings public read" on public.site_settings;
create policy "site_settings public read" on public.site_settings
  for select
  using (
    key not in ('gemini_api_key', 'google_service_account', 'gemini_keys', 'review_queue_secret')
    or public.is_admin()
  );

-- The trigger reads the secret itself (SECURITY DEFINER bypasses RLS) and passes
-- it in a header the Edge Function validates in constant time.
create or replace function public.trigger_process_review_queue()
returns void as $$
declare
  v_secret text;
begin
  select s.value #>> '{}'
    into v_secret
    from public.site_settings s
   where s.key = 'review_queue_secret';

  perform net.http_post(
    url := 'https://mjuzjvyatunjmgaiqtdv.supabase.co/functions/v1/process-review-queue',
    headers := jsonb_build_object('Content-Type', 'application/json')
               || case
                    when coalesce(v_secret, '') = '' then '{}'::jsonb
                    else jsonb_build_object('x-worker-secret', v_secret)
                  end,
    body := '{"source": "pg_cron_or_trigger"}'::jsonb
  );
end;
$$ language plpgsql security definer set search_path = '';

-- ---------------------------------------------------------------------------
-- 3. Contact form: server-side timestamps and a per-email hourly cap
--
-- 0024 added length CHECKs but the client still chose created_at (so messages
-- could be backdated out of the inbox view) and nothing rate-limited a flood.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_contact_message_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recent integer;
begin
  -- The client can no longer choose when a message was sent.
  new.created_at := now();
  new.updated_at := now();
  new.id := coalesce(new.id, gen_random_uuid());

  select count(*)
    into v_recent
    from public.contact_messages
   where lower(email) = lower(new.email)
     and created_at > now() - interval '1 hour';

  if v_recent >= 5 then
    raise exception 'Too many messages from this email address. Please try again later.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists contact_messages_enforce_limits on public.contact_messages;
create trigger contact_messages_enforce_limits
  before insert on public.contact_messages
  for each row execute function public.enforce_contact_message_limits();

-- Trigger functions are invoked by the trigger machinery, never called directly.
revoke execute on function public.enforce_contact_message_limits() from public, anon, authenticated;
