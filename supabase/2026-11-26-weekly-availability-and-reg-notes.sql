-- ShiftReady: weekly pool availability + notes on registration links.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to re-run.

-- 1. Notes on registration links: who it's for ("Coventry tonight, Jamie", "Recent Indeed applications").
alter table public.temps add column if not exists reg_note text;

-- 2. Weekly availability. Every Friday 8am everyone in a pool is texted a link to tick the days they want shifts
--    the following week (Mon-Sun). Their ticks are worker_days. The office can add days (office_on) or take days off
--    (office_off) after a call; office changes win. Days they can do = (worker_days + office_on) - office_off.
create table if not exists public.pool_week (
  id           uuid primary key default gen_random_uuid(),
  pool_id      uuid not null references public.pools (id) on delete cascade,
  temp_id      uuid not null references public.temps (id) on delete cascade,
  week_start   date not null,                        -- the Monday
  worker_days  smallint[] not null default '{}',     -- 1 = Mon ... 7 = Sun, ticked by the worker
  office_on    smallint[] not null default '{}',     -- added by the office
  office_off   smallint[] not null default '{}',     -- taken off by the office
  office_by    uuid references public.profiles (id) on delete set null,
  office_at    timestamptz,
  updated_at   timestamptz not null default now(),
  unique (pool_id, temp_id, week_start)
);
create index if not exists pool_week_pool_idx on public.pool_week (pool_id, week_start);

-- One text per worker per week (covers every pool they're in), with their own link.
create table if not exists public.pool_week_asks (
  id           uuid primary key default gen_random_uuid(),
  temp_id      uuid not null references public.temps (id) on delete cascade,
  week_start   date not null,
  token        uuid not null unique default gen_random_uuid(),
  sent_at      timestamptz,
  reminded_at  timestamptz,
  replied_at   timestamptz,
  created_at   timestamptz not null default now(),
  unique (temp_id, week_start)
);

alter table public.pool_week enable row level security;
alter table public.pool_week_asks enable row level security;
drop policy if exists pool_week_staff on public.pool_week;
create policy pool_week_staff on public.pool_week for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists pool_week_asks_staff on public.pool_week_asks;
create policy pool_week_asks_staff on public.pool_week_asks for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Runs every 15 minutes; the app decides what's due (Friday 8am texts, Saturday 12pm reminders).
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.unschedule(jobid) from cron.job where jobname = 'shiftready-availability';
select cron.schedule(
  'shiftready-availability',
  '*/15 * * * *',
  $$ select net.http_get(
       url := 'https://shiftready-tan.vercel.app/api/cron/availability',
       headers := jsonb_build_object('x-cron-key', (select value from public.app_secrets where name = 'cron_key'))
     ) $$
);
