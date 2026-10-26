-- ShiftReady: proof of NI uploads, plus holiday and P45 requests from temps (sent to payroll).
-- Run once in Supabase: SQL Editor > New query > paste all of this > Run. Safe to re-run.

-- Allow "proof of NI number" uploads.
alter table public.temp_documents drop constraint if exists temp_documents_kind_check;
alter table public.temp_documents add constraint temp_documents_kind_check
  check (kind in ('passport', 'id', 'rtw_check', 'ni_proof', 'flt_licence', 'other'));

-- Who handles payroll requests (ticked on the Team page). They get a text for every new request.
alter table public.profiles add column if not exists payroll boolean not null default false;

create table if not exists public.temp_requests (
  id             uuid primary key default gen_random_uuid(),
  temp_id        uuid not null references public.temps (id) on delete cascade,
  kind           text not null check (kind in ('holiday', 'p45')),
  status         text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'done')),
  start_date     date,              -- holiday
  end_date       date,              -- holiday
  days           numeric(4,1),      -- holiday: working days requested
  last_day       date,              -- P45: last day worked
  delivery       text check (delivery in ('email', 'post')),   -- P45
  note           text,
  response_note  text,
  handled_by     uuid references public.profiles (id) on delete set null,
  handled_at     timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists temp_requests_status_idx on public.temp_requests (status, created_at desc);
create index if not exists temp_requests_temp_idx on public.temp_requests (temp_id, created_at desc);

alter table public.temp_requests enable row level security;
drop policy if exists temp_requests_staff_read on public.temp_requests;
drop policy if exists temp_requests_staff_update on public.temp_requests;
create policy temp_requests_staff_read   on public.temp_requests for select to authenticated using (public.is_staff());
create policy temp_requests_staff_update on public.temp_requests for update to authenticated using (public.is_staff()) with check (public.is_staff());
