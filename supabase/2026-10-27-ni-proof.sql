-- ShiftReady: allow "proof of NI number" uploads. Run once in Supabase SQL Editor. Safe to re-run.
alter table public.temp_documents drop constraint if exists temp_documents_kind_check;
alter table public.temp_documents add constraint temp_documents_kind_check
  check (kind in ('passport', 'id', 'rtw_check', 'ni_proof', 'flt_licence', 'other'));
