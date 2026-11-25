-- ShiftReady: remember when a booking was confirmed by phone, so the shift page keeps showing it in green.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to re-run.
alter table public.offers add column if not exists phone_confirmed_at timestamptz;
alter table public.offers add column if not exists phone_confirmed_by uuid references public.profiles (id) on delete set null;
