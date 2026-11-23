-- ShiftReady: Jobs board. Temp jobs that need filling (client, role, how many, pay, shift pattern), with the
-- candidates put forward for each. Run once in Supabase: SQL Editor > New query > paste > Run. Safe to re-run.
create table if not exists public.jobs (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid references public.clients (id) on delete set null,
  client_name    text not null,
  role           text not null,                 -- what they need, e.g. "Warehouse Operative"
  heads          integer not null default 1 check (heads > 0),
  pay_rate       numeric(8,2),                  -- £ per hour to the temp
  charge_rate    numeric(8,2),                  -- £ per hour to the client (admins only see this)
  shift_pattern  text,                          -- e.g. "Nights 18:30-03:00, Mon-Fri"
  start_date     date,
  location       text,                          -- site or postcode
  requirements   text,                          -- e.g. "FLT counterbalance, own safety boots"
  notes          text,
  status         text not null default 'open' check (status in ('open', 'filled', 'closed')),
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  filled_at      timestamptz
);
create index if not exists jobs_status_idx on public.jobs (status, start_date);

create table if not exists public.job_candidates (
  id        uuid primary key default gen_random_uuid(),
  job_id    uuid not null references public.jobs (id) on delete cascade,
  temp_id   uuid not null references public.temps (id) on delete cascade,
  status    text not null default 'proposed' check (status in ('proposed', 'confirmed', 'started', 'dropped')),
  note      text,
  added_by  uuid references public.profiles (id) on delete set null,
  added_at  timestamptz not null default now(),
  unique (job_id, temp_id)
);
create index if not exists job_candidates_job_idx on public.job_candidates (job_id);

alter table public.jobs enable row level security;
alter table public.job_candidates enable row level security;
drop policy if exists jobs_staff on public.jobs;
create policy jobs_staff on public.jobs for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists job_candidates_staff on public.job_candidates;
create policy job_candidates_staff on public.job_candidates for all to authenticated using (public.is_staff()) with check (public.is_staff());
