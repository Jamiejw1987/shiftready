-- ShiftReady: let staff text a temp a link to CHANGE bank details already on file.
-- The link only accepts a change for 48 hours after staff send it. Run once in Supabase SQL Editor. Safe to re-run.
alter table temps add column if not exists bank_change_until timestamptz;
