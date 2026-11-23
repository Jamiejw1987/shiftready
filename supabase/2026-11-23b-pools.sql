-- ShiftReady: Pools. Everyone booked on a shift at a site goes into that site's pool automatically, so the office can
-- see who's worked there, mark which days of the week each person wants, and mass-text them at short notice.
-- A site is the shift's client name + site postcode (so "DHL" at CV3 4FL is one pool however the shift was made).
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to re-run.

create table if not exists public.pools (
  id             uuid primary key default gen_random_uuid(),
  client         text not null,
  site           text not null,
  site_postcode  text not null,
  client_id      uuid references public.clients (id) on delete set null,
  site_id        uuid references public.client_sites (id) on delete set null,
  client_key     text generated always as (lower(regexp_replace(btrim(client), '\s+', ' ', 'g'))) stored,
  postcode_key   text generated always as (upper(replace(site_postcode, ' ', ''))) stored,
  created_at     timestamptz not null default now()
);
create unique index if not exists pools_site_key on public.pools (client_key, postcode_key);

create table if not exists public.pool_members (
  id          uuid primary key default gen_random_uuid(),
  pool_id     uuid not null references public.pools (id) on delete cascade,
  temp_id     uuid not null references public.temps (id) on delete cascade,
  days        smallint[] not null default '{}',   -- days they want to work: 1 = Mon ... 7 = Sun
  source      text not null default 'shift' check (source in ('shift', 'manual')),
  last_shift  date,                                -- their latest booked shift at this site
  added_at    timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (pool_id, temp_id)
);
create index if not exists pool_members_pool_idx on public.pool_members (pool_id);
create index if not exists pool_members_temp_idx on public.pool_members (temp_id);

alter table public.pools enable row level security;
alter table public.pool_members enable row level security;
drop policy if exists pools_staff on public.pools;
create policy pools_staff on public.pools for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists pool_members_staff on public.pool_members;
create policy pool_members_staff on public.pool_members for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Puts a booked temp into the pool for that shift's site. Runs on every booking, whichever screen or text made it.
-- Never stops a booking: if anything goes wrong here the booking still goes through.
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
    insert into public.pool_members (pool_id, temp_id, source, last_shift) values (p, new.temp_id, 'shift', s.shift_date)
      on conflict (pool_id, temp_id) do update
        set last_shift = greatest(public.pool_members.last_shift, excluded.last_shift);
  exception when others then
    raise warning 'pools_on_booking: %', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists offers_pools on public.offers;
create trigger offers_pools after insert or update of status on public.offers
  for each row execute function public.pools_on_booking();

-- Fill the pools from everyone already booked on a shift.
insert into public.pools (client, site, site_postcode, client_id, site_id)
select distinct on (lower(regexp_replace(btrim(s.client), '\s+', ' ', 'g')), upper(replace(s.site_postcode, ' ', '')))
       btrim(s.client), btrim(s.site), s.site_postcode, s.client_id, s.site_id
from public.offers o join public.shifts s on s.id = o.shift_id
where o.status = 'accepted' and btrim(s.client) <> '' and btrim(s.site_postcode) <> ''
order by lower(regexp_replace(btrim(s.client), '\s+', ' ', 'g')), upper(replace(s.site_postcode, ' ', '')), s.shift_date desc
on conflict (client_key, postcode_key) do nothing;

insert into public.pool_members (pool_id, temp_id, source, last_shift)
select p.id, o.temp_id, 'shift', max(s.shift_date)
from public.offers o
join public.shifts s on s.id = o.shift_id
join public.pools p on p.client_key = lower(regexp_replace(btrim(s.client), '\s+', ' ', 'g')) and p.postcode_key = upper(replace(s.site_postcode, ' ', ''))
where o.status = 'accepted'
group by p.id, o.temp_id
on conflict (pool_id, temp_id) do update set last_shift = greatest(public.pool_members.last_shift, excluded.last_shift);
