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

-- The EVRi / DHL HSE induction form: pages 1 and 8 hold the worker's details and the on-site sign-off.
-- Staff Selection fills those in; temps read and initial pages 2 to 7.
update public.induction_docs
   set hidden_pages = '{1,8}'
 where template = 'evri_hse_v12' and hidden_pages = '{}' and archived_at is null;
