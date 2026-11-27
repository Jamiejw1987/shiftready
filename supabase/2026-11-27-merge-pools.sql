-- ShiftReady: merge pools. When the same site has ended up as two pools (a one-letter difference in the client name
-- or postcode on a shift), merge one into the other: everyone moves across with their usual days and weekly answers,
-- and future bookings with the old spelling go into the merged pool.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to re-run.

-- The old pool stays as a hidden pointer, so a new booking with that spelling still finds the right pool.
alter table public.pools add column if not exists merged_into uuid references public.pools (id) on delete set null;

create or replace function public.pools_on_booking()
returns trigger language plpgsql security definer set search_path = public as $$
declare s record; p uuid;
begin
  if new.status <> 'accepted' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'accepted' then return new; end if;
  begin
    select client, site, site_postcode, client_id, site_id, shift_date into s from public.shifts where id = new.shift_id;
    if not found or coalesce(btrim(s.client), '') = '' or coalesce(btrim(s.site_postcode), '') = '' then return new; end if;
    insert into public.pools (client, site, site_postcode, client_id, site_id)
      values (btrim(s.client), btrim(s.site), s.site_postcode, s.client_id, s.site_id)
      on conflict (client_key, postcode_key) do update
        set client_id = coalesce(public.pools.client_id, excluded.client_id), site_id = coalesce(public.pools.site_id, excluded.site_id)
      returning id into p;
    -- Merged away? Use the pool it was merged into.
    select coalesce(merged_into, id) into p from public.pools where id = p;
    insert into public.pool_members (pool_id, temp_id, source, last_shift) values (p, new.temp_id, 'shift', s.shift_date)
      on conflict (pool_id, temp_id) do update
        set last_shift = greatest(public.pool_members.last_shift, excluded.last_shift);
  exception when others then
    raise warning 'pools_on_booking: %', sqlerrm;
  end;
  return new;
end $$;

-- Moves everyone from one pool into another, in one go. People in both keep everything: their days are combined.
create or replace function public.merge_pools(p_from uuid, p_into uuid)
returns json language plpgsql security definer set search_path = public as $$
declare moved int; joined int;
begin
  if not public.is_staff() then raise exception 'Not allowed'; end if;
  if p_from = p_into then raise exception 'Pick a different pool to merge into.'; end if;
  if not exists (select 1 from public.pools where id = p_from and merged_into is null) then raise exception 'That pool has already been merged.'; end if;
  if not exists (select 1 from public.pools where id = p_into and merged_into is null) then raise exception 'The pool to merge into isn''t available.'; end if;

  -- People in both pools: combine their usual days, keep their latest shift there.
  update public.pool_members t
     set days = array(select distinct d from unnest(t.days || f.days) d order by d),
         last_shift = greatest(t.last_shift, f.last_shift), updated_at = now()
    from public.pool_members f
   where f.pool_id = p_from and t.pool_id = p_into and t.temp_id = f.temp_id;
  get diagnostics joined = row_count;
  delete from public.pool_members f using public.pool_members t
   where f.pool_id = p_from and t.pool_id = p_into and t.temp_id = f.temp_id;
  update public.pool_members set pool_id = p_into where pool_id = p_from;
  get diagnostics moved = row_count;

  -- Weekly answers: combine for anyone with answers in both, move the rest.
  update public.pool_week t
     set worker_days = array(select distinct d from unnest(t.worker_days || f.worker_days) d order by d),
         office_on   = array(select distinct d from unnest(t.office_on || f.office_on) d order by d),
         office_off  = array(select distinct d from unnest(t.office_off || f.office_off) d
                              where d <> all (t.office_on || f.office_on) order by d),
         updated_at = now()
    from public.pool_week f
   where f.pool_id = p_from and t.pool_id = p_into and t.temp_id = f.temp_id and t.week_start = f.week_start;
  delete from public.pool_week f using public.pool_week t
   where f.pool_id = p_from and t.pool_id = p_into and t.temp_id = f.temp_id and t.week_start = f.week_start;
  update public.pool_week set pool_id = p_into where pool_id = p_from;

  -- Keep the old pool as a hidden pointer (and repoint anything merged into it before).
  update public.pools set merged_into = p_into where id = p_from or merged_into = p_from;
  update public.pools t set client_id = coalesce(t.client_id, f.client_id), site_id = coalesce(t.site_id, f.site_id)
    from public.pools f where t.id = p_into and f.id = p_from;
  return json_build_object('moved', moved, 'joined', joined);
end $$;
grant execute on function public.merge_pools(uuid, uuid) to authenticated;
