-- ShiftReady database schema
-- Run this once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- Safe to re-run: it only creates things that don't exist yet and replaces functions/policies.

create extension if not exists pgcrypto;

-- ---------- Types ----------
do $$ begin
  create type public.user_role as enum ('admin', 'consultant');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.temp_status as enum ('pending', 'active', 'hold', 'out');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.offer_status as enum ('sent', 'accepted', 'declined', 'standby', 'alerts', 'noshow');
exception when duplicate_object then null; end $$;

-- ---------- Tables ----------

-- Consultants. One row per login (auth.users).
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null,
  email       text not null unique,
  role        public.user_role not null default 'consultant',
  mobile      text,                       -- optional: consultant gets a text when a temp accepts their shift
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Temps. Only compliant temps are added (KISREC remains the system of record for compliance).
create table if not exists public.temps (
  id            uuid primary key default gen_random_uuid(),
  first_name    text not null,
  last_name     text not null,
  mobile        text not null unique,     -- E.164, e.g. +447700900123
  postcode      text not null,
  lat           double precision,
  lng           double precision,
  job_types     text[] not null default '{}',
  status        public.temp_status not null default 'pending',
  optin_token   uuid not null unique default gen_random_uuid(),
  opted_in_at   timestamptz,
  opted_out_at  timestamptz,
  added_by      uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists temps_status_idx on public.temps (status);

create table if not exists public.shifts (
  id             uuid primary key default gen_random_uuid(),
  client         text not null,
  site           text not null,
  site_postcode  text not null,
  lat            double precision,
  lng            double precision,
  shift_date     date not null,
  start_time     time not null,
  end_time       time not null,
  job_type       text not null,
  duties         text[] not null default '{}',
  pay_rate       numeric(8,2) not null check (pay_rate >= 0),
  heads          integer not null check (heads > 0),
  radius_miles   numeric(5,1) not null check (radius_miles > 0),
  ppe            text[] not null default '{}',
  status         text not null default 'open' check (status in ('open', 'filled', 'cancelled')),
  sent_by        uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists shifts_date_idx on public.shifts (shift_date);

-- One offer per temp per shift. The token is the temp's private link.
create table if not exists public.offers (
  id              uuid primary key default gen_random_uuid(),
  shift_id        uuid not null references public.shifts (id) on delete cascade,
  temp_id         uuid not null references public.temps (id) on delete cascade,
  token           uuid not null unique default gen_random_uuid(),
  distance_miles  numeric(5,1),
  status          public.offer_status not null default 'sent',
  decline_reason  text,
  standby_at      timestamptz,
  ppe_confirmed   boolean not null default false,
  responded_at    timestamptz,
  reminded_at     timestamptz,
  created_at      timestamptz not null default now(),
  unique (shift_id, temp_id)
);
create index if not exists offers_shift_idx on public.offers (shift_id, status);

-- Every text in and out.
create table if not exists public.messages (
  id           uuid primary key default gen_random_uuid(),
  temp_id      uuid references public.temps (id) on delete set null,
  to_number    text,
  from_number  text,
  direction    text not null check (direction in ('out', 'in')),
  kind         text not null,             -- welcome, offer, bulk, reminder, promoted, reply, system
  body         text not null,
  segments     integer,
  provider_id  text,
  status       text,                      -- queued, sent, failed, dry-run, received
  error        text,
  sent_by      uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists messages_temp_idx on public.messages (temp_id, created_at desc);

-- Who did what. actor is null for actions taken by temps or by the system.
create table if not exists public.audit_log (
  id          bigserial primary key,
  actor       uuid references public.profiles (id) on delete set null,
  action      text not null,
  detail      text,
  created_at  timestamptz not null default now()
);
create index if not exists audit_created_idx on public.audit_log (created_at desc);

-- ---------- Access helpers ----------
-- Staff = signed in, active profile, and passed two-factor (aal2).
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active)
     and coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active and p.role = 'admin')
     and coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

-- ---------- Row level security ----------
alter table public.profiles  enable row level security;
alter table public.temps     enable row level security;
alter table public.shifts    enable row level security;
alter table public.offers    enable row level security;
alter table public.messages  enable row level security;
alter table public.audit_log enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());
drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists temps_staff on public.temps;
create policy temps_staff on public.temps for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists shifts_staff on public.shifts;
create policy shifts_staff on public.shifts for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists offers_staff on public.offers;
create policy offers_staff on public.offers for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists messages_staff on public.messages;
create policy messages_staff on public.messages for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists audit_insert on public.audit_log;
create policy audit_insert on public.audit_log for insert to authenticated
  with check (public.is_staff() and actor = auth.uid());
drop policy if exists audit_admin_read on public.audit_log;
create policy audit_admin_read on public.audit_log for select to authenticated
  using (public.is_admin());

-- ---------- Offer responses (called by the server for the temp's private link) ----------
-- Locks the shift row so two temps can never take the last place at the same time.
create or replace function public.respond_to_offer(p_token uuid, p_action text, p_reason text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  o public.offers;
  s public.shifts;
  t public.temps;
  filled integer;
begin
  select * into o from public.offers where token = p_token;
  if not found then return 'not_found'; end if;
  select * into s from public.shifts where id = o.shift_id for update;
  select * into o from public.offers where id = o.id for update;
  select * into t from public.temps where id = o.temp_id;

  if s.status = 'cancelled' then return 'cancelled'; end if;
  if o.status = 'noshow' then return 'noshow'; end if;

  if p_action = 'accept' then
    if o.status = 'accepted' then return 'accepted'; end if;
    if t.status <> 'active' then return 'not_active'; end if;
    select count(*) into filled from public.offers where shift_id = s.id and status = 'accepted';
    if filled >= s.heads then return 'full'; end if;
    update public.offers set status = 'accepted', ppe_confirmed = true, responded_at = now(), standby_at = null where id = o.id;
    if filled + 1 >= s.heads then update public.shifts set status = 'filled' where id = s.id; end if;
    insert into public.audit_log (actor, action, detail)
      values (null, 'offer.accepted', t.first_name || ' ' || t.last_name || ' accepted ' || s.client || ' on ' || to_char(s.shift_date, 'Dy DD Mon'));
    return 'accepted';
  elsif p_action = 'decline' then
    if o.status = 'accepted' then return 'accepted'; end if;
    update public.offers set status = 'declined', decline_reason = left(p_reason, 60), responded_at = now(), standby_at = null where id = o.id;
    return 'declined';
  elsif p_action = 'standby' then
    if o.status = 'accepted' then return 'accepted'; end if;
    update public.offers set status = 'standby', standby_at = now(), responded_at = now() where id = o.id;
    return 'standby';
  elsif p_action = 'alerts' then
    if o.status = 'accepted' then return 'accepted'; end if;
    update public.offers set status = 'alerts', responded_at = now(), standby_at = null where id = o.id;
    return 'alerts';
  elsif p_action = 'reset' then
    update public.offers set status = 'sent', decline_reason = null, standby_at = null
      where id = o.id and status in ('declined', 'standby', 'alerts');
    return 'sent';
  end if;
  return 'invalid';
end $$;

revoke all on function public.respond_to_offer(uuid, text, text) from public, anon, authenticated;
grant execute on function public.respond_to_offer(uuid, text, text) to service_role;

-- Consultant marks a confirmed temp as a no-show. The first person on standby is promoted.
-- Returns the promoted offer id, or null if nobody was on standby.
create or replace function public.mark_no_show(p_offer_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  o public.offers;
  s public.shifts;
  nxt public.offers;
begin
  if not public.is_staff() then raise exception 'not allowed'; end if;
  select * into o from public.offers where id = p_offer_id;
  if not found or o.status <> 'accepted' then raise exception 'offer is not confirmed'; end if;
  select * into s from public.shifts where id = o.shift_id for update;
  update public.offers set status = 'noshow' where id = o.id;

  select * into nxt from public.offers
    where shift_id = s.id and status = 'standby'
    order by standby_at asc limit 1 for update;
  if found then
    update public.offers set status = 'accepted', responded_at = now(), standby_at = null where id = nxt.id;
    return nxt.id;
  end if;
  update public.shifts set status = 'open' where id = s.id and status = 'filled';
  return null;
end $$;

revoke all on function public.mark_no_show(uuid) from public, anon;
grant execute on function public.mark_no_show(uuid) to authenticated;

-- ---------- Tighter access rules (replace the broad staff policies above) ----------

-- Consultants can add and edit temps, but only admins can delete them (GDPR erasure).
drop policy if exists temps_staff on public.temps;
drop policy if exists temps_staff_read on public.temps;
drop policy if exists temps_staff_insert on public.temps;
drop policy if exists temps_staff_update on public.temps;
drop policy if exists temps_admin_delete on public.temps;
create policy temps_staff_read   on public.temps for select to authenticated using (public.is_staff());
create policy temps_staff_insert on public.temps for insert to authenticated with check (public.is_staff());
create policy temps_staff_update on public.temps for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy temps_admin_delete on public.temps for delete to authenticated using (public.is_admin());

-- The text log is a record: consultants can read and add to it, only admins can change or delete it.
drop policy if exists messages_staff on public.messages;
drop policy if exists messages_staff_read on public.messages;
drop policy if exists messages_staff_insert on public.messages;
drop policy if exists messages_admin_update on public.messages;
drop policy if exists messages_admin_delete on public.messages;
create policy messages_staff_read    on public.messages for select to authenticated using (public.is_staff());
create policy messages_staff_insert  on public.messages for insert to authenticated with check (public.is_staff());
create policy messages_admin_update  on public.messages for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy messages_admin_delete  on public.messages for delete to authenticated using (public.is_admin());

-- Shifts and offers can't be deleted outright (cancel instead), so the history stays intact.
drop policy if exists shifts_staff on public.shifts;
drop policy if exists shifts_staff_read on public.shifts;
drop policy if exists shifts_staff_insert on public.shifts;
drop policy if exists shifts_staff_update on public.shifts;
create policy shifts_staff_read   on public.shifts for select to authenticated using (public.is_staff());
create policy shifts_staff_insert on public.shifts for insert to authenticated with check (public.is_staff());
create policy shifts_staff_update on public.shifts for update to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists offers_staff on public.offers;
drop policy if exists offers_staff_read on public.offers;
drop policy if exists offers_staff_insert on public.offers;
drop policy if exists offers_staff_update on public.offers;
create policy offers_staff_read   on public.offers for select to authenticated using (public.is_staff());
create policy offers_staff_insert on public.offers for insert to authenticated with check (public.is_staff());
create policy offers_staff_update on public.offers for update to authenticated using (public.is_staff()) with check (public.is_staff());

-- Helper functions don't need to be callable by people who aren't signed in.
revoke execute on function public.is_staff() from public, anon;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_staff() to authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;
