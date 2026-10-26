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

-- ---------- WhatsApp ----------

-- Whether each temp is reachable on WhatsApp: unknown until we try, then yes or no.
alter table public.temps add column if not exists wa_status text not null default 'unknown';
do $$ begin
  alter table public.temps add constraint temps_wa_status_check check (wa_status in ('unknown', 'yes', 'no'));
exception when duplicate_object then null; end $$;

-- Which channel each message used, which offer it was about (so a WhatsApp button tap finds the
-- right shift), and the text version to send if WhatsApp can't deliver it.
alter table public.messages add column if not exists channel text not null default 'sms';
alter table public.messages add column if not exists offer_id uuid references public.offers (id) on delete set null;
alter table public.messages add column if not exists fallback_body text;
alter table public.messages add column if not exists fell_back boolean not null default false;
create index if not exists messages_provider_idx on public.messages (provider_id);


-- ================= Registration (also in 2026-10-27-registration.sql) =================
-- ---------- New temp statuses ----------
-- invited = registration link sent, not filled in yet. review = filled in, waiting for a consultant to check.
alter type public.temp_status add value if not exists 'invited';
alter type public.temp_status add value if not exists 'review';

-- Invited candidates don't have a postcode until they register.
alter table public.temps alter column postcode drop not null;

alter table public.temps add column if not exists reg_token uuid not null default gen_random_uuid();
do $$ begin
  alter table public.temps add constraint temps_reg_token_key unique (reg_token);
exception when duplicate_object or duplicate_table then null; end $$;
alter table public.temps add column if not exists reg_requested_at timestamptz;   -- registration link sent
alter table public.temps add column if not exists registered_at timestamptz;      -- form submitted
alter table public.temps add column if not exists approved_at timestamptz;
alter table public.temps add column if not exists approved_by uuid references public.profiles (id) on delete set null;
-- Right to work
alter table public.temps add column if not exists rtw_route text;                 -- british_irish | share_code
alter table public.temps add column if not exists rtw_checked_at timestamptz;
alter table public.temps add column if not exists rtw_checked_by uuid references public.profiles (id) on delete set null;
alter table public.temps add column if not exists rtw_expires date;               -- null = no time limit
-- Set when the candidate declared a health matter or an unspent conviction: an admin must approve them.
alter table public.temps add column if not exists needs_admin_review boolean not null default false;
alter table public.temps add column if not exists bank_on_file boolean not null default false;
do $$ begin
  alter table public.temps add constraint temps_rtw_route_check check (rtw_route in ('british_irish', 'share_code'));
exception when duplicate_object then null; end $$;

-- ---------- Registration details ----------
-- Columns ending _enc are encrypted by the app (AES-256-GCM) before they reach the database,
-- so they can't be read here, in backups or through the API without the app's key.
create table if not exists public.temp_profiles (
  temp_id            uuid primary key references public.temps (id) on delete cascade,
  dob                date,
  email              text,
  address1           text,
  address2           text,
  town               text,
  ni_enc             text,
  experience         text,
  transport          text,
  own_ppe            text[] not null default '{}',
  availability       text[] not null default '{}',
  share_code         text,
  nok_name           text,
  nok_relationship   text,
  nok_phone          text,
  health_enc         text,             -- { declared: boolean, details: string }
  convictions_enc    text,             -- { declared: boolean, details: string }
  wtr_opt_out        boolean,          -- true = opted out of the 48-hour average weekly limit
  wtr_changed_at     timestamptz,
  wtr_effective      date,             -- when the latest change takes effect (after notice if withdrawing)
  privacy_ack_at     timestamptz,
  messages_consent   boolean,
  signature_name     text,
  signed_at          timestamptz,
  signed_ip          text,
  bank_enc           text,             -- { name, sortCode, account }
  bank_last4         text,
  bank_added_at      timestamptz,
  submitted_at       timestamptz,
  updated_at         timestamptz not null default now()
);

-- Uploaded files (passport photos, right to work check results, licences). Files live in the private
-- "documents" storage bucket; this table records what each one is.
create table if not exists public.temp_documents (
  id           uuid primary key default gen_random_uuid(),
  temp_id      uuid not null references public.temps (id) on delete cascade,
  kind         text not null check (kind in ('passport', 'id', 'rtw_check', 'flt_licence', 'other')),
  path         text not null unique,
  filename     text,
  uploaded_by  uuid references public.profiles (id) on delete set null,   -- null = uploaded by the candidate
  created_at   timestamptz not null default now()
);
create index if not exists temp_documents_temp_idx on public.temp_documents (temp_id);

-- The wording candidates read and sign. Each change is a new version, so you can always see exactly
-- what someone agreed to.
create table if not exists public.app_documents (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('kid', 'terms', 'wtr', 'privacy')),
  version     integer not null,
  title       text not null,
  body        text not null,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (kind, version)
);

create table if not exists public.temp_signatures (
  id           uuid primary key default gen_random_uuid(),
  temp_id      uuid not null references public.temps (id) on delete cascade,
  document_id  uuid not null references public.app_documents (id),
  action       text not null default 'signed',   -- signed | wtr_opt_out | wtr_withdraw
  signed_name  text not null,
  signed_at    timestamptz not null default now(),
  ip           text
);
create index if not exists temp_signatures_temp_idx on public.temp_signatures (temp_id);

-- Standard 48-hour opt-out wording. Admins can change it on the Team > Documents page.
insert into public.app_documents (kind, version, title, body)
select 'wtr', 1, 'Opting out of the 48-hour week',
'Under the Working Time Regulations 1998, you should not work more than 48 hours a week on average (normally averaged over 17 weeks), unless you choose to opt out.

By opting out, you agree that the 48-hour average weekly limit will not apply to you while you work through Staff Selection UK.

Opting out is your choice. You will not be treated less favourably if you decide not to opt out.

You can cancel this opt-out at any time by giving us 7 days'' notice. You can do this from your ShiftReady link, or by telling the office.

Opting out does not affect your rights to rest breaks, daily and weekly rest, or paid holiday.'
where not exists (select 1 from public.app_documents where kind = 'wtr');

-- Starting drafts of the Key Information Document, terms and privacy notice. Admins can change them on Team > Documents.

insert into public.app_documents (kind, version, title, body)
select 'kid', 1, 'Key Information Document', $doc$KEY INFORMATION DOCUMENT

This document tells you the key information about your work through Staff Selection UK Ltd. It does not form part of your contract. Your terms of engagement set out the full terms.

Your name: {full_name}
Date issued: {date}

ABOUT YOUR EMPLOYMENT BUSINESS
Name: Staff Selection UK Ltd (company number 14238416)
Address: 2 Hawk Road, Dewsbury, WF12 7AY
Contact: info@staffselectionuk.com

TYPE OF CONTRACT
You will be engaged on a contract for services as a temporary agency worker. You are a worker, not an employee. We will offer you assignments with our clients from time to time. We don't have to offer you work, and you don't have to accept it.

START DATE AND LENGTH OF ASSIGNMENTS
You can start once your registration and right to work check are complete. Most assignments are individual shifts or short periods. Each shift offer tells you the date, times, place and expected length.

WHO WILL PAY YOU
Staff Selection UK Ltd pays you directly, through PAYE. No umbrella company or other intermediary is involved.

HOW OFTEN YOU WILL BE PAID
Weekly. You are paid every Friday, by 5pm, for the work you did in the previous week.

YOUR RATE OF PAY
Your rate of pay depends on the assignment and is shown on every shift offer before you accept it. It will never be less than the National Minimum Wage or National Living Wage for your age.

EXAMPLE OF PAY
This is an example only. Your actual pay and deductions depend on your rate, your hours and your tax code.
40 hours at £12.71 an hour = £508.40 gross pay for the week.
Income tax (tax code 1257L): £53.30
Employee National Insurance: £21.31
Pension (NEST, 4% of qualifying earnings after tax relief): £15.54
Net pay: £418.25

DEDUCTIONS WE MUST MAKE BY LAW
Income tax and employee National Insurance contributions. If you are enrolled in the workplace pension, your pension contributions.

OTHER DEDUCTIONS
None. We do not make any other deductions from your pay.

FEES
We will never charge you a fee for finding you work.

HOLIDAY
You are entitled to 5.6 weeks' paid holiday a year, including bank holidays, worked out in proportion to the hours you work. Holiday builds up at 12.07% of the hours you work in each pay period. You take holiday as paid time off, booked in advance with us. Holiday pay is calculated in line with the law, normally using your average weekly pay over the previous 52 weeks that you worked. The holiday year runs from 1 January to 31 December.

PENSION
If you are eligible, we will automatically enrol you in our workplace pension with NEST. We pay employer contributions on top of your pay. You can opt out if you wish.

OTHER BENEFITS
Statutory Sick Pay, if you qualify. After 12 weeks in the same role with the same client, you are entitled to the same basic pay and working conditions as if the client had hired you directly (Agency Workers Regulations 2010).

QUESTIONS OR COMPLAINTS
Email info@staffselectionuk.com. You can also contact the Employment Agency Standards Inspectorate at gov.uk/government/organisations/employment-agency-standards-inspectorate.$doc$
where not exists (select 1 from public.app_documents where kind = 'kid');

insert into public.app_documents (kind, version, title, body)
select 'terms', 1, 'Terms of engagement', $doc$TERMS OF ENGAGEMENT FOR TEMPORARY WORKERS

These terms are between Staff Selection UK Ltd (company number 14238416), 2 Hawk Road, Dewsbury, WF12 7AY ("we", "us") and {full_name} ("you"). They apply to every assignment you do through us. Issued: {date}.

1. YOUR STATUS
1.1 You are engaged on a contract for services. You are a worker, not an employee, and these terms do not create a contract of employment between you and us or between you and any client.
1.2 We act as an employment business under the Conduct of Employment Agencies and Employment Businesses Regulations 2003.
1.3 We will pay you for the work you do on assignments, whether or not the client pays us.

2. ASSIGNMENTS
2.1 We may offer you assignments with our clients from time to time. We are not obliged to offer you work and you are not obliged to accept it.
2.2 Each offer will tell you the client, place, date, times, type of work, any safety equipment you need, and your rate of pay. By accepting, you confirm you can attend and that you have any equipment listed.
2.3 There may be periods when no work is available. These terms continue between assignments until either of us ends them.

3. WHAT WE EXPECT FROM YOU
3.1 Arrive on time, follow the client's reasonable instructions, site rules and health and safety procedures, and wear the safety equipment required.
3.2 If you can't attend a shift you have accepted, or you will be late, tell us as soon as possible and before the shift starts.
3.3 Do not accept work directly from a client you were introduced to through us during an assignment without telling us first.
3.4 Keep confidential any information about the client's business that you learn on an assignment.
3.5 Tell us straight away about any accident, injury or near miss at work.
3.6 Tell us if your right to work in the UK, contact details or bank details change.

4. RIGHT TO WORK
4.1 You must have the right to work in the UK. We will check this before your first assignment and again before any time limit expires. We cannot offer you work if your right to work cannot be confirmed.

5. TIMESHEETS
5.1 Your hours are recorded by us or the client and confirmed by the client. Check your hours and tell us of any mistake as soon as you can.

6. PAY
6.1 Your hourly rate for each assignment is set out in the offer. It will never be less than the National Minimum Wage or National Living Wage for your age.
6.2 We pay you weekly, every Friday by 5pm, for the work you did in the previous week, by bank transfer to the account you give us.
6.3 We deduct income tax and National Insurance under PAYE, and pension contributions if you are enrolled. We make no other deductions unless the law requires it or you agree in writing.
6.4 We will give you a payslip each pay day.
6.5 We will never charge you a fee for finding you work.

7. HOLIDAY
7.1 You are entitled to 5.6 weeks' paid holiday in each holiday year (1 January to 31 December), worked out in proportion to the hours you work. Holiday builds up at 12.07% of the hours you work in each pay period.
7.2 To book holiday, tell us at least twice as many days in advance as the holiday you want to take. We may refuse a request with notice where there is a good business reason.
7.3 Holiday pay is calculated in line with the Working Time Regulations 1998, normally using your average weekly pay over the previous 52 weeks you worked.
7.4 Holiday must be taken in the holiday year in which it builds up, except where the law allows it to be carried over. When these terms end, we will pay you for any holiday you have built up but not taken.

8. WORKING TIME AND REST
8.1 You must not work more than an average of 48 hours a week unless you have chosen to opt out in writing. You can cancel an opt-out at any time with 7 days' notice.
8.2 You are entitled to rest breaks, daily and weekly rest in line with the Working Time Regulations 1998.

9. SICKNESS
9.1 If you are ill and can't attend a shift, tell us before the shift starts. You may be entitled to Statutory Sick Pay if you meet the qualifying conditions.

10. PENSION
10.1 If you are eligible, we will automatically enrol you in our workplace pension with NEST and pay employer contributions. You can opt out.

11. AGENCY WORKERS REGULATIONS
11.1 After 12 continuous calendar weeks in the same role with the same client, you are entitled to the same basic working and employment conditions as if the client had recruited you directly, including pay. From day one you are entitled to use the client's shared facilities and to be told about relevant job vacancies.

12. ENDING AN ASSIGNMENT OR THESE TERMS
12.1 Either you or we can end an assignment at any time without notice. We will pay you for all hours worked.
12.2 We may end an assignment straight away if you seriously break these terms or the client's rules, or if the client no longer needs you.
12.3 Either of us can end these terms at any time by telling the other.

13. YOUR DATA
13.1 We use your personal information as explained in our privacy notice.

14. QUESTIONS AND COMPLAINTS
14.1 Email info@staffselectionuk.com. We will respond as soon as we can.

15. GENERAL
15.1 These terms, with each assignment offer, are the whole agreement between us. We may update these terms by telling you in writing, and the new version will apply to assignments you accept after that.
15.2 These terms are governed by the law of England and Wales.$doc$
where not exists (select 1 from public.app_documents where kind = 'terms');

insert into public.app_documents (kind, version, title, body)
select 'privacy', 1, 'Privacy notice', $doc$PRIVACY NOTICE FOR TEMPORARY WORKERS

Staff Selection UK Ltd (company number 14238416), 2 Hawk Road, Dewsbury, WF12 7AY, is the controller of your personal data. Contact us about your data at info@staffselectionuk.com.

WHAT WE COLLECT
- Your name, mobile number, email, address, date of birth and National Insurance number.
- The work you can do, your experience, availability, transport and safety equipment.
- Right to work information: your share code and check result, or a copy of your passport.
- Licences and certificates you give us, such as an FLT licence.
- Your emergency contact's name, relationship and phone number. Please tell them you have given us their details.
- Health information you choose to tell us, so we can keep you safe at work and make adjustments.
- Whether you have unspent criminal convictions, and any details you give.
- Your choice about the 48-hour working week, and your signatures on our documents.
- Your bank details, once you are booked onto a shift.
- Shifts offered, accepted, declined and attended, and the messages we exchange with you.

WHY WE USE IT, AND OUR LEGAL BASIS
- To find you work and run your engagement with us (our contract with you).
- To check your right to work, pay you, deduct tax and National Insurance, enrol you in a pension, keep working time records and meet other legal duties (legal obligation).
- To keep you and others safe at work, and contact your emergency contact if needed (legal obligation and legitimate interests; vital interests in an emergency).
- Health information: to meet our health and safety and employment law duties (UK GDPR Article 9(2)(b) and Data Protection Act 2018, Schedule 1, paragraph 1).
- Criminal convictions information: to assess suitability for work, under Data Protection Act 2018, Schedule 1, with an appropriate policy document in place.
- To send you shift offers by text and WhatsApp (your consent, which you can withdraw at any time by replying STOP).

WHO SEES IT
- Our consultants. Health, convictions and bank details are restricted to our admin team, and every view is recorded.
- Clients you work for: your name and what they need to know for the shift. We don't share your health, convictions or bank details with clients without your agreement, unless the law requires it.
- HMRC, NEST (our pension provider), and others where the law requires.
- Companies that run our systems for us: Supabase (secure database and file storage), Vercel (website hosting), Twilio (text messages) and Meta (WhatsApp). Some of these may process data outside the UK, protected by UK-approved safeguards such as the UK International Data Transfer Addendum or the UK-US Data Bridge.

HOW WE PROTECT IT
Your most sensitive details (National Insurance number, health, convictions and bank details) are encrypted. Documents are stored privately and opened only through short-lived secure links. Staff accounts use two-factor sign-in.

HOW LONG WE KEEP IT
- Right to work records: while you work with us and for 2 years after.
- Pay, tax and pension records: 6 years after the end of the tax year they relate to.
- Working time records: at least 2 years.
- Other records: 2 years after you last worked with us or last contacted us, then deleted.

YOUR RIGHTS
You can ask to see, correct or delete your data, ask us to restrict or stop using it, or ask for a copy to take elsewhere. Some data we must keep by law. Email info@staffselectionuk.com.
If you are unhappy with how we use your data, you can complain to the Information Commissioner's Office at ico.org.uk or on 0303 123 1113.

Last updated: October 2026.$doc$
where not exists (select 1 from public.app_documents where kind = 'privacy');

-- ---------- Access rules ----------
alter table public.temp_profiles   enable row level security;
alter table public.temp_documents  enable row level security;
alter table public.app_documents   enable row level security;
alter table public.temp_signatures enable row level security;

drop policy if exists temp_profiles_staff_read on public.temp_profiles;
drop policy if exists temp_profiles_staff_update on public.temp_profiles;
create policy temp_profiles_staff_read   on public.temp_profiles for select to authenticated using (public.is_staff());
create policy temp_profiles_staff_update on public.temp_profiles for update to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists temp_documents_staff_read on public.temp_documents;
drop policy if exists temp_documents_staff_insert on public.temp_documents;
drop policy if exists temp_documents_admin_delete on public.temp_documents;
create policy temp_documents_staff_read   on public.temp_documents for select to authenticated using (public.is_staff());
create policy temp_documents_staff_insert on public.temp_documents for insert to authenticated with check (public.is_staff());
create policy temp_documents_admin_delete on public.temp_documents for delete to authenticated using (public.is_admin());

drop policy if exists app_documents_staff_read on public.app_documents;
drop policy if exists app_documents_admin_insert on public.app_documents;
create policy app_documents_staff_read   on public.app_documents for select to authenticated using (public.is_staff());
create policy app_documents_admin_insert on public.app_documents for insert to authenticated with check (public.is_admin());

drop policy if exists temp_signatures_staff_read on public.temp_signatures;
create policy temp_signatures_staff_read on public.temp_signatures for select to authenticated using (public.is_staff());

-- ---------- Private file storage ----------
-- No storage policies are added on purpose: nobody can read or upload directly. The app hands out
-- short-lived signed links instead, after checking who is asking.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 15728640,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do nothing;

-- ShiftReady: allow "proof of NI number" uploads. Run once in Supabase SQL Editor. Safe to re-run.
alter table public.temp_documents drop constraint if exists temp_documents_kind_check;
alter table public.temp_documents add constraint temp_documents_kind_check
  check (kind in ('passport', 'id', 'rtw_check', 'ni_proof', 'flt_licence', 'other'));

-- ================= Requests (also in 2026-10-27-requests.sql) =================
-- Who handles payroll requests (ticked on the Team page). They get a text for every new request.
alter table public.profiles add column if not exists payroll boolean not null default false;

create table if not exists public.temp_requests (
  id             uuid primary key default gen_random_uuid(),
  temp_id        uuid not null references public.temps (id) on delete cascade,
  kind           text not null check (kind in ('holiday', 'p45')),
  status         text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'done')),
  start_date     date,              -- holiday
  end_date       date,              -- holiday
  days           numeric(4,1),      -- holiday: working days requested
  last_day       date,              -- P45: last day worked
  delivery       text check (delivery in ('email', 'post')),   -- P45
  note           text,
  response_note  text,
  handled_by     uuid references public.profiles (id) on delete set null,
  handled_at     timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists temp_requests_status_idx on public.temp_requests (status, created_at desc);
create index if not exists temp_requests_temp_idx on public.temp_requests (temp_id, created_at desc);

alter table public.temp_requests enable row level security;
drop policy if exists temp_requests_staff_read on public.temp_requests;
drop policy if exists temp_requests_staff_update on public.temp_requests;
create policy temp_requests_staff_read   on public.temp_requests for select to authenticated using (public.is_staff());
create policy temp_requests_staff_update on public.temp_requests for update to authenticated using (public.is_staff()) with check (public.is_staff());
