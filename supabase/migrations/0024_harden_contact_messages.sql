-- 0024_harden_contact_messages.sql
-- Harden contact messages table against spam floods:
-- 1. Add CHECK constraints for maximum character lengths
-- 2. Restrict public insert with check on non-empty values and realistic constraints

-- Add constraints to prevent unbounded payload bloat
alter table public.contact_messages
  drop constraint if exists contact_messages_name_len,
  drop constraint if exists contact_messages_email_len,
  drop constraint if exists contact_messages_subject_len,
  drop constraint if exists contact_messages_message_len;

alter table public.contact_messages
  add constraint contact_messages_name_len check (char_length(trim(name)) between 1 and 100),
  add constraint contact_messages_email_len check (char_length(trim(email)) between 5 and 120 and email like '%@%.%'),
  add constraint contact_messages_subject_len check (subject is null or char_length(subject) <= 200),
  add constraint contact_messages_message_len check (char_length(trim(message)) between 1 and 3000);

-- Harden RLS policy: Reject rows that attempt to inject status other than 'unread' or alter internal fields
drop policy if exists "contact_messages public insert" on public.contact_messages;
create policy "contact_messages public insert" on public.contact_messages
    for insert with check (
        status = 'unread'
        and reply_notes is null
    );
