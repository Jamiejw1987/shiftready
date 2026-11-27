-- ShiftReady: only use registration days for people who sign up from now on (the new "Which days can you work?" form).
-- Also undoes the fill-in that 2026-11-27b-reg-days-to-pools.sql did for people already in pools.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to re-run.

-- Registration days count only for sign-ups submitted on the new form (from 27 Nov 2026, 11:10).
create or replace function public.reg_days(p_temp uuid)
returns smallint[] language sql stable security definer set search_path = public as $$
  select coalesce(array(
    select distinct array_position(array['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], x)::smallint d
      from public.temp_profiles p, unnest(p.availability) x
     where p.temp_id = p_temp and p.submitted_at >= timestamptz '2026-11-27 11:10:00+00'
       and x = any (array['Mon','Tue','Wed','Thu','Fri','Sat','Sun'])
     order by d), '{}')
$$;

-- Undo this morning's fill-in: blank the usual days it set for people who registered before the new form.
-- Only rows changed by that run (between 11:00 and 11:30 today) whose days still exactly match their old registration answer.
update public.pool_members m set days = '{}', updated_at = now()
  from public.temp_profiles p
 where p.temp_id = m.temp_id
   and (p.submitted_at is null or p.submitted_at < timestamptz '2026-11-27 11:10:00+00')
   and m.updated_at >= timestamptz '2026-11-27 11:00:00+00' and m.updated_at < timestamptz '2026-11-27 11:30:00+00'
   and coalesce(array_length(m.days, 1), 0) > 0
   and m.days = coalesce(array(
         select distinct array_position(array['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], x)::smallint d
           from unnest(p.availability) x where x = any (array['Mon','Tue','Wed','Thu','Fri','Sat','Sun']) order by d), '{}');
