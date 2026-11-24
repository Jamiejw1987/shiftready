-- ShiftReady: one shift a day, enforced by the database as well as the app.
-- The app already checks before every booking or accept. This is the backstop: if two accepts for the same day land
-- at the same moment (or any future screen forgets to check), the database refuses the second one.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to re-run.

create or replace function public.one_shift_a_day()
returns trigger language plpgsql security definer set search_path = public as $$
declare d date; other text;
begin
  if new.status not in ('accepted', 'interested') then return new; end if;
  if tg_op = 'UPDATE' and old.status in ('accepted', 'interested') and old.shift_id = new.shift_id then return new; end if;
  -- One at a time per temp, so two accepts at the same moment can't both get through.
  perform pg_advisory_xact_lock(hashtext('one_shift_a_day:' || new.temp_id::text));
  select shift_date into d from public.shifts where id = new.shift_id;
  if d is null then return new; end if;
  select s.client into other
    from public.offers o join public.shifts s on s.id = o.shift_id
   where o.temp_id = new.temp_id and o.id <> new.id and o.shift_id <> new.shift_id
     and o.status in ('accepted', 'interested') and s.status <> 'cancelled' and s.shift_date = d
   limit 1;
  if other is not null then
    raise exception 'This temp already has a shift on % (%). One shift a day.', to_char(d, 'DD Mon'), other using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists offers_one_shift_a_day on public.offers;
create trigger offers_one_shift_a_day before insert or update of status, shift_id on public.offers
  for each row execute function public.one_shift_a_day();
