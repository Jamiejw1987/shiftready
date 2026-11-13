-- ShiftReady: remember who the consultant unticked when a shift went out (13 Nov 2026).
-- Without this, "Send to more temps" treated everyone who was left out as "new" and sent it to them later.
-- Run once in Supabase > SQL Editor. Safe to re-run.
alter table public.shifts add column if not exists left_out uuid[] not null default '{}';
