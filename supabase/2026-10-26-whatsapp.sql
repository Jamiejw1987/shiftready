-- WhatsApp with automatic text fallback (26 Oct 2026). Run once in Supabase > SQL Editor.
-- Safe to re-run. Already included in schema.sql for new installs.

-- Whether each temp is reachable on WhatsApp: unknown until we try, then yes or no.
alter table public.temps add column if not exists wa_status text not null default 'unknown';
do $$ begin
  alter table public.temps add constraint temps_wa_status_check check (wa_status in ('unknown', 'yes', 'no'));
exception when duplicate_object then null; end $$;

-- Which channel each message used, which offer it was about (so a WhatsApp button tap finds the
-- right shift), and the text version to send if WhatsApp can't deliver it.
alter table public.messages add column if not exists channel text not null default 'sms';
alter table public.messages add column if not exists offer_id uuid references public.offers (id) on delete set null;
alter table public.messages add column if not exists fallback_body text;
alter table public.messages add column if not exists fell_back boolean not null default false;
create index if not exists messages_provider_idx on public.messages (provider_id);
