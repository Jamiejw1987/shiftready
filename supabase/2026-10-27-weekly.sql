-- ShiftReady: weekly shifts. One offer covers several days; temps say which days they can do, consultants book from a week grid.
-- Run once in Supabase SQL Editor. Safe to re-run.
alter table public.shifts add column if not exists series_id uuid;
create index if not exists shifts_series_idx on public.shifts (series_id);
alter table public.offers add column if not exists available boolean;        -- temp's answer for that day (null = not answered)
alter table public.offers add column if not exists available_at timestamptz;
