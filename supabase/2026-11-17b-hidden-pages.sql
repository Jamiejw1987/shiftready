-- ShiftReady: pages of a client document that temps don't see (e.g. the blank group "Record of Instruction"
-- sign-in sheet at the end of each DHL briefing and SOM). Run once in Supabase SQL Editor. Safe to re-run.
alter table public.induction_docs add column if not exists hidden_pages integer[] not null default '{}';

-- DHL packs already uploaded: hide the last page (the Record of Instruction sheet) of every briefing and SOM.
update public.induction_docs
   set hidden_pages = array[page_count]
 where hidden_pages = '{}'
   and archived_at is null
   and page_count > 1
   and template is null
   and (title ilike 'HSE0%' or title ilike 'SOM %');
