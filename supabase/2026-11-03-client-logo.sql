-- ShiftReady: client logos (shown in a circle at the top of the client's portal). Run once in Supabase SQL Editor. Safe to re-run.
alter table public.clients add column if not exists logo text;   -- small image, resized in the browser before saving
