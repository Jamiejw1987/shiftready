-- ShiftReady: ongoing workers, "no messages" switch and silent imports (16 Nov 2026).
-- Run once in Supabase > SQL Editor. Safe to re-run.

-- 1. No messages: when ticked, ShiftReady sends this worker nothing at all (texts, WhatsApp or email),
--    whoever presses the button and whatever the message. Each blocked message is still recorded as "suppressed".
--    Reason: 'ongoing' (working at a client week in week out), 'imported' (brought in from another system), 'manual'.
alter table public.temps add column if not exists no_comms        boolean not null default false;
alter table public.temps add column if not exists no_comms_reason text;
alter table public.temps add column if not exists no_comms_at     timestamptz;
alter table public.temps add column if not exists no_comms_by     uuid references public.profiles (id) on delete set null;
create index if not exists temps_no_comms_idx on public.temps (no_comms) where no_comms;

-- 2. Imported records: where they came from and their ID in the old system.
alter table public.temps add column if not exists imported_at   timestamptz;
alter table public.temps add column if not exists import_source text;
alter table public.temps add column if not exists external_ref  text;
create index if not exists temps_external_ref_idx on public.temps (external_ref) where external_ref is not null;

-- 3. Ongoing assignments: a worker working at a client week in week out, with or without an end date.
--    Still working there = end_date is blank (or in the future).
create table if not exists public.client_workers (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  site_id     uuid references public.client_sites (id) on delete set null,
  temp_id     uuid not null references public.temps (id) on delete cascade,
  job_title   text,
  start_date  date not null default current_date,
  end_date    date,
  notes       text,
  added_by    uuid references public.profiles (id) on delete set null,
  ended_by    uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
create index if not exists client_workers_client_idx on public.client_workers (client_id);
create index if not exists client_workers_temp_idx on public.client_workers (temp_id);
-- One open assignment per worker per client.
create unique index if not exists client_workers_open_key on public.client_workers (client_id, temp_id) where end_date is null;

alter table public.client_workers enable row level security;
drop policy if exists client_workers_staff_read on public.client_workers;
drop policy if exists client_workers_staff_insert on public.client_workers;
drop policy if exists client_workers_staff_update on public.client_workers;
create policy client_workers_staff_read   on public.client_workers for select to authenticated using (public.is_staff());
create policy client_workers_staff_insert on public.client_workers for insert to authenticated with check (public.is_staff());
create policy client_workers_staff_update on public.client_workers for update to authenticated using (public.is_staff()) with check (public.is_staff());
