-- ShiftReady: weekly hours limit for temps who legally can't work more than a set number of hours (13 Nov 2026).
-- e.g. students on a visa limited to 20 hours a week in term time. Blank = no limit.
-- Weeks run Monday to Sunday; a shift counts in the week it starts.
-- Run once in Supabase > SQL Editor. Safe to re-run.
alter table public.temps add column if not exists hours_cap integer check (hours_cap is null or (hours_cap between 1 and 60));
alter table public.temps add column if not exists hours_cap_reason text;
