-- ShiftReady: ask temps to confirm when a consultant books them on. Run once in Supabase SQL Editor. Safe to re-run.
alter table public.offers add column if not exists awaiting_confirm boolean not null default false;
alter table public.offers add column if not exists confirm_asked_at timestamptz;
