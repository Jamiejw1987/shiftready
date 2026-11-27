-- ShiftReady: the days someone said they can work when they registered become their usual days in a pool.
-- When they're first booked at a site (or added to its pool), their pool row starts with those days ticked.
-- Also fills in usual days for anyone already in a pool with none ticked yet.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to re-run.

-- Registration days (Mon..Sun on their profile) as 1 = Mon ... 7 = Sun.
create or replace function public.reg_days(p_temp uuid)
returns smallint[] language sql stable security definer set search_path = public as $$
  select coalesce(array(
    select distinct array_position(array['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], x)::smallint d
      from public.temp_profiles p, unnest(p.availability) x
     where p.temp_id = p_temp and x = any (array['Mon','Tue','Wed','Thu','Fri','Sat','Sun'])
     order by d), '{}')
$$;

-- New pool members start with their registration days (unless days were already set).
create or replace function public.pool_members_reg_days()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(array_length(new.days, 1), 0) = 0 then
    begin new.days := public.reg_days(new.temp_id); exception when others then null; end;
  end if;
  return new;
end $$;
drop trigger if exists pool_members_reg_days on public.pool_members;
create trigger pool_members_reg_days before insert on public.pool_members
  for each row execute function public.pool_members_reg_days();

-- Anyone already in a pool with no usual days ticked: use what they said when they registered.
update public.pool_members m set days = public.reg_days(m.temp_id), updated_at = now()
 where coalesce(array_length(m.days, 1), 0) = 0 and coalesce(array_length(public.reg_days(m.temp_id), 1), 0) > 0;
