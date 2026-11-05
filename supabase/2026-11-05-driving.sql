-- Driving work: licence details candidates give when they register, and the office's DVLA check.
-- Safe to run more than once.

alter table public.temp_profiles
  add column if not exists driving_licence_no    text,
  add column if not exists driving_categories    text[] not null default '{}',
  add column if not exists driving_points        integer,
  add column if not exists driving_check_code    text,
  add column if not exists driving_check_code_at timestamptz,
  add column if not exists licence_checked_at    timestamptz,
  add column if not exists licence_checked_by    uuid references public.profiles (id) on delete set null,
  add column if not exists licence_check_notes   text;

-- Photos of driving licences.
alter table public.temp_documents drop constraint if exists temp_documents_kind_check;
alter table public.temp_documents add constraint temp_documents_kind_check
  check (kind in ('passport', 'id', 'rtw_check', 'ni_proof', 'flt_licence', 'driving_licence', 'other'));
