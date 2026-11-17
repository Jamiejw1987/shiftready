-- ShiftReady: manual handling practical assessment done in the app on day one (Yes/No per check, trainer and
-- candidate sign on screen). Run once in Supabase SQL Editor. Safe to re-run.
create table if not exists public.induction_assessments (
  id            uuid primary key default gen_random_uuid(),
  induction_id  uuid not null references public.temp_inductions (id) on delete cascade,
  kind          text not null default 'mh_practical',
  answers       jsonb not null,               -- { itemId: true (Yes) | false (No) }
  location      text,
  trainer_name  text not null,
  coaching      text,                         -- sections where corrective coaching was given
  candidate_sig text not null,                -- PNG data URL
  trainer_sig   text not null,
  by_staff      uuid references public.profiles (id) on delete set null,
  by_supervisor uuid references public.site_supervisors (id) on delete set null,
  ip            text,
  at            timestamptz not null default now()
);
create index if not exists induction_assessments_ind_idx on public.induction_assessments (induction_id);
alter table public.induction_assessments enable row level security;
drop policy if exists induction_assessments_staff_read on public.induction_assessments;
create policy induction_assessments_staff_read on public.induction_assessments for select to authenticated using (public.is_staff());

alter table public.temp_documents drop constraint if exists temp_documents_kind_check;
alter table public.temp_documents add constraint temp_documents_kind_check
  check (kind in ('passport', 'id', 'rtw_check', 'ni_proof', 'flt_licence', 'driving_licence', 'other', 'induction_site', 'mh_assessment'));
