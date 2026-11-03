-- ShiftReady: client portal. Run once in Supabase: SQL Editor > New query > paste > Run. Safe to re-run.
--
-- Clients post shift requests and give feedback; Staff Selection decides who is booked.
-- Clients sign in by email link (no password). They are NOT staff: they have no row in profiles,
-- so every existing staff-only rule (temps, offers, messages...) keeps them out automatically.
-- What clients can read is limited by the rules at the bottom of this file, and the names of booked
-- temps only come through portal_people(), which never returns contact details.

-- ---------- Offers: temps can only say they're interested in a client-requested shift ----------
alter type public.offer_status add value if not exists 'interested';

-- ---------- Clients ----------
create table if not exists public.clients (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  cutoff_hours  integer not null default 12 check (cutoff_hours between 0 and 168),  -- later than this before start = urgent, and can't cancel online
  is_test       boolean not null default false,                                       -- demo clients: left out of reports
  active        boolean not null default true,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);
create unique index if not exists clients_name_key on public.clients (lower(name));

create table if not exists public.client_sites (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  name        text not null,                 -- what the client calls it, e.g. "Bradford"
  address     text not null,
  postcode    text not null,
  lat         double precision,
  lng         double precision,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists client_sites_client_idx on public.client_sites (client_id);

-- People at the client who can sign in. One row per person; their sign-in is an auth.users row with no staff profile.
create table if not exists public.client_users (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.clients (id) on delete cascade,
  auth_user_id   uuid unique references auth.users (id) on delete set null,
  email          text not null,
  full_name      text,
  mobile         text,
  job_title      text,
  all_sites      boolean not null default true,     -- false = only the sites in client_user_sites
  status         text not null default 'invited' check (status in ('invited', 'active', 'removed')),
  invited_by     uuid references public.profiles (id) on delete set null,
  invited_at     timestamptz not null default now(),
  joined_at      timestamptz,
  last_login_at  timestamptz,
  removed_at     timestamptz,
  created_at     timestamptz not null default now()
);
create unique index if not exists client_users_email_key on public.client_users (lower(email));
create index if not exists client_users_client_idx on public.client_users (client_id);

create table if not exists public.client_user_sites (
  client_user_id  uuid not null references public.client_users (id) on delete cascade,
  site_id         uuid not null references public.client_sites (id) on delete cascade,
  primary key (client_user_id, site_id)
);

-- Saved shifts a client can repeat (e.g. every Friday 14:00-22:00, 5 people).
create table if not exists public.client_templates (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  site_id     uuid not null references public.client_sites (id) on delete cascade,
  name        text not null,
  start_time  time not null,
  end_time    time not null,
  role        text not null,
  headcount   integer not null check (headcount between 1 and 200),
  notes       text,
  created_by  uuid references public.client_users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists client_templates_client_idx on public.client_templates (client_id);

-- A shift a client has asked for. Staff Selection turns it into a shift and books people.
create table if not exists public.client_requests (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references public.clients (id) on delete cascade,
  site_id            uuid not null references public.client_sites (id),
  created_by         uuid references public.client_users (id) on delete set null,
  request_date       date not null,
  start_time         time not null,
  end_time           time not null,
  role               text not null,
  headcount          integer not null check (headcount between 1 and 200),
  notes              text,
  status             text not null default 'submitted' check (status in ('submitted', 'acknowledged', 'cancelled')),
  is_urgent          boolean not null default false,
  template_id        uuid references public.client_templates (id) on delete set null,
  acknowledged_by    uuid references public.profiles (id) on delete set null,
  acknowledged_at    timestamptz,
  cancelled_at       timestamptz,
  cancelled_by_client boolean,
  cancel_reason      text,
  filled_notified_at timestamptz,               -- when the client was emailed that it's fully booked
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists client_requests_client_idx on public.client_requests (client_id, request_date);
create index if not exists client_requests_status_idx on public.client_requests (status, created_at desc);

-- Shifts made from a client request: who the client is, which site, and that the office confirms every booking.
alter table public.shifts add column if not exists client_id uuid references public.clients (id) on delete set null;
alter table public.shifts add column if not exists site_id uuid references public.client_sites (id) on delete set null;
alter table public.shifts add column if not exists request_id uuid references public.client_requests (id) on delete set null;
alter table public.shifts add column if not exists confirm_first boolean not null default false;
create index if not exists shifts_request_idx on public.shifts (request_id);
create index if not exists shifts_site_idx on public.shifts (site_id, shift_date);

-- Attendance and rating the client gives each booked temp.
create table if not exists public.client_feedback (
  offer_id        uuid primary key references public.offers (id) on delete cascade,
  client_id       uuid not null references public.clients (id) on delete cascade,
  temp_id         uuid not null references public.temps (id) on delete cascade,
  request_id      uuid references public.client_requests (id) on delete set null,
  attended        boolean,                       -- true = attended, false = no-show
  marked_by       uuid references public.client_users (id) on delete set null,
  marked_at       timestamptz,
  stars           smallint check (stars between 1 and 5),
  return_to_site  boolean,                       -- only asked for 1 or 2 stars
  comment         text,
  rated_by        uuid references public.client_users (id) on delete set null,
  rated_at        timestamptz,
  updated_at      timestamptz not null default now()
);
create index if not exists client_feedback_temp_idx on public.client_feedback (temp_id, client_id);

-- A client said they don't want someone back. Applies to that client's shifts only.
create table if not exists public.client_blocks (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  temp_id     uuid not null references public.temps (id) on delete cascade,
  offer_id    uuid references public.offers (id) on delete set null,
  reason      text,
  created_by  uuid references public.client_users (id) on delete set null,
  created_at  timestamptz not null default now(),
  lifted_at   timestamptz,
  lifted_by   uuid references public.profiles (id) on delete set null,
  lift_note   text
);
create unique index if not exists client_blocks_live_key on public.client_blocks (client_id, temp_id) where lifted_at is null;

-- In-app alerts for the office (new client requests, edits, cancellations, blocks).
create table if not exists public.staff_notifications (
  id          bigserial primary key,
  kind        text not null,
  title       text not null,
  body        text,
  link        text,
  urgent      boolean not null default false,
  client_id   uuid references public.clients (id) on delete cascade,
  request_id  uuid references public.client_requests (id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index if not exists staff_notifications_created_idx on public.staff_notifications (created_at desc);

alter table public.profiles add column if not exists notif_seen_at timestamptz;
alter table public.profiles add column if not exists client_email_alerts boolean not null default true;  -- each person can mute
alter table public.profiles add column if not exists client_sms_alerts boolean not null default true;    -- admins switch on/off

-- ---------- Audit trail: who at the client did it, and what changed ----------
alter table public.audit_log add column if not exists client_user_id uuid references public.client_users (id) on delete set null;
alter table public.audit_log add column if not exists client_id uuid references public.clients (id) on delete set null;
alter table public.audit_log add column if not exists entity text;
alter table public.audit_log add column if not exists entity_id uuid;
alter table public.audit_log add column if not exists before jsonb;
alter table public.audit_log add column if not exists after jsonb;
create index if not exists audit_client_idx on public.audit_log (client_id, created_at desc);
create index if not exists audit_entity_idx on public.audit_log (entity_id);

-- ---------- Who is signed in at a client ----------
create or replace function public.portal_client_id()
returns uuid language sql stable security definer set search_path = public as $$
  select cu.client_id from public.client_users cu join public.clients c on c.id = cu.client_id
  where cu.auth_user_id = auth.uid() and cu.status in ('invited', 'active') and c.active
  limit 1;
$$;

create or replace function public.portal_site_ok(p_site uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.client_users cu
    join public.clients c on c.id = cu.client_id and c.active
    join public.client_sites s on s.client_id = cu.client_id and s.id = p_site
    where cu.auth_user_id = auth.uid() and cu.status in ('invited', 'active')
      and (cu.all_sites or exists (select 1 from public.client_user_sites x where x.client_user_id = cu.id and x.site_id = p_site))
  );
$$;

revoke execute on function public.portal_client_id() from public, anon;
revoke execute on function public.portal_site_ok(uuid) from public, anon;
grant execute on function public.portal_client_id() to authenticated, service_role;
grant execute on function public.portal_site_ok(uuid) to authenticated, service_role;

-- ---------- Access rules ----------
alter table public.clients             enable row level security;
alter table public.client_sites        enable row level security;
alter table public.client_users        enable row level security;
alter table public.client_user_sites   enable row level security;
alter table public.client_templates    enable row level security;
alter table public.client_requests     enable row level security;
alter table public.client_feedback     enable row level security;
alter table public.client_blocks       enable row level security;
alter table public.staff_notifications enable row level security;

-- Staff: read and write everything here (deletes go through the server).
do $$
declare t text;
begin
  foreach t in array array['clients', 'client_sites', 'client_users', 'client_user_sites', 'client_templates', 'client_requests', 'client_feedback', 'client_blocks', 'staff_notifications'] loop
    execute format('drop policy if exists %I on public.%I', t || '_staff_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff_update', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_staff())', t || '_staff_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_staff())', t || '_staff_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_staff()) with check (public.is_staff())', t || '_staff_update', t);
  end loop;
end $$;

-- Client users: read only their own company's records, and only the sites they look after.
-- They can't write directly: every change goes through ShiftReady, which checks it and records it.
drop policy if exists clients_portal_read on public.clients;
create policy clients_portal_read on public.clients for select to authenticated using (id = public.portal_client_id());
drop policy if exists client_sites_portal_read on public.client_sites;
create policy client_sites_portal_read on public.client_sites for select to authenticated using (public.portal_site_ok(id));
drop policy if exists client_users_portal_read on public.client_users;
create policy client_users_portal_read on public.client_users for select to authenticated using (auth_user_id = auth.uid());
drop policy if exists client_user_sites_portal_read on public.client_user_sites;
create policy client_user_sites_portal_read on public.client_user_sites for select to authenticated
  using (exists (select 1 from public.client_users cu where cu.id = client_user_id and cu.auth_user_id = auth.uid()));
drop policy if exists client_templates_portal_read on public.client_templates;
create policy client_templates_portal_read on public.client_templates for select to authenticated using (public.portal_site_ok(site_id));
drop policy if exists client_requests_portal_read on public.client_requests;
create policy client_requests_portal_read on public.client_requests for select to authenticated using (public.portal_site_ok(site_id));
drop policy if exists client_feedback_portal_read on public.client_feedback;
create policy client_feedback_portal_read on public.client_feedback for select to authenticated using (client_id = public.portal_client_id());

-- ---------- The only way a client sees temps: name, induction flag and their own feedback ----------
-- Staff can call it too (for "View as client"). Never returns mobile, email, address or anything else.
create or replace function public.portal_people(p_request_ids uuid[])
returns table (
  request_id uuid, offer_id uuid, first_name text, last_name text, been_before boolean,
  no_show_by_office boolean, attended boolean, stars smallint, return_to_site boolean, comment text
)
language sql stable security definer set search_path = public as $$
  select r.id, o.id, t.first_name, t.last_name,
    exists (
      select 1 from public.offers po
      join public.shifts ps on ps.id = po.shift_id
      left join public.client_feedback pf on pf.offer_id = po.id
      where po.temp_id = o.temp_id and po.status = 'accepted' and po.id <> o.id
        and ps.site_id = r.site_id and ps.status <> 'cancelled' and ps.shift_date < s.shift_date
        and coalesce(pf.attended, true)
    ),
    o.status = 'noshow',
    f.attended, f.stars, f.return_to_site, f.comment
  from public.client_requests r
  join public.shifts s on s.request_id = r.id and s.status <> 'cancelled'
  join public.offers o on o.shift_id = s.id and o.status in ('accepted', 'noshow')
  join public.temps t on t.id = o.temp_id
  left join public.client_feedback f on f.offer_id = o.id
  where r.id = any (p_request_ids)
    and (public.is_staff() or public.portal_site_ok(r.site_id))
  order by t.first_name, t.last_name;
$$;
revoke execute on function public.portal_people(uuid[]) from public, anon;
grant execute on function public.portal_people(uuid[]) to authenticated, service_role;

-- ---------- Offer replies: interest only on client-requested shifts ----------
-- On a shift with confirm_first, a temp saying YES (or asking for standby) is recorded as "interested".
-- Nobody is booked until someone in the office confirms them.
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

  if s.confirm_first and p_action in ('accept', 'standby') then
    if o.status = 'accepted' then return 'accepted'; end if;
    if o.status = 'interested' then return 'interested'; end if;
    if t.status <> 'active' then return 'not_active'; end if;
    if exists (select 1 from public.client_blocks b where b.client_id = s.client_id and b.temp_id = t.id and b.lifted_at is null) then
      return 'closed';
    end if;
    update public.offers set status = 'interested', ppe_confirmed = true, responded_at = now(), standby_at = null where id = o.id;
    insert into public.audit_log (actor, action, detail, client_id, entity, entity_id)
      values (null, 'offer.interested', t.first_name || ' ' || t.last_name || ' said they can do ' || s.client || ' on ' || to_char(s.shift_date, 'Dy DD Mon'),
              s.client_id, 'shift', s.id);
    return 'interested';
  end if;

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
      where id = o.id and status in ('declined', 'standby', 'alerts', 'interested');
    return 'sent';
  end if;
  return 'invalid';
end $$;

revoke all on function public.respond_to_offer(uuid, text, text) from public, anon, authenticated;
grant execute on function public.respond_to_offer(uuid, text, text) to service_role;
