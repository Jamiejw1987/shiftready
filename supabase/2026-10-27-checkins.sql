-- ShiftReady: "still attending?" check-in texts about 2 hours before each shift.
-- Run once in Supabase: SQL Editor > New query > paste all of this > Run. Safe to re-run.

-- What happened with each booked temp's check-in.
alter table public.offers add column if not exists checkin_sent_at timestamptz;
alter table public.offers add column if not exists checkin_reply text;          -- yes | no
alter table public.offers add column if not exists checkin_replied_at timestamptz;
alter table public.offers add column if not exists checkin_alerted_at timestamptz;  -- consultant told about no reply

-- A private key the database uses to call ShiftReady's check-in job. Nobody can read this table through the API.
create table if not exists public.app_secrets (name text primary key, value text not null);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;
insert into public.app_secrets (name, value) values ('cron_key', encode(gen_random_bytes(24), 'hex'))
on conflict (name) do nothing;

-- Every 10 minutes, ask ShiftReady to send any check-ins that are due.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.unschedule(jobid) from cron.job where jobname = 'shiftready-checkins';
select cron.schedule(
  'shiftready-checkins',
  '*/10 * * * *',
  $$ select net.http_get(
       url := 'https://shiftready-tan.vercel.app/api/cron/checkins',
       headers := jsonb_build_object('x-cron-key', (select value from public.app_secrets where name = 'cron_key'))
     ) $$
);
