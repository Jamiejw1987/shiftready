-- ShiftReady: client induction packs (e.g. DHL / EVRi agency induction) and site supervisor logins.
-- Run once in Supabase: SQL Editor > New query > paste all of this > Run. Safe to re-run.
--
-- How it fits together
--   induction_packs      one per client induction (e.g. "DHL / EVRi agency induction")
--   induction_docs       the client's own PDFs in the pack, in order (files live in the private "documents" bucket)
--   temp_inductions      a pack sent to one temp: their private link, the details printed on the form, and progress
--   induction_marks      every tick, initial and signature the temp gives, page by page, with time, IP and device
--   site_supervisors     limited logins for the person running day one on site: they only upload the signed sheet

-- ---------- Packs ----------
create table if not exists public.induction_packs (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  client_id       uuid references public.clients (id) on delete set null,
  default_site    text,                      -- printed on the form, e.g. "Coventry Hub"
  default_scope   text,                      -- e.g. "Warehouse Operative"
  default_arrival text,                      -- e.g. "18:00"
  agency_name     text not null default 'Staff Selection UK Ltd',
  active          boolean not null default true,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now()
);

create table if not exists public.induction_docs (
  id           uuid primary key default gen_random_uuid(),
  pack_id      uuid not null references public.induction_packs (id) on delete cascade,
  position     integer not null default 0,
  title        text not null,
  path         text not null,                -- original PDF, untouched
  page_count   integer not null check (page_count > 0),
  page_sizes   jsonb not null default '[]',  -- [[width, height], ...] in PDF points
  page_images  text[] not null default '{}', -- one picture per page, shown to the temp
  template     text,                         -- known client form with printed fields, e.g. 'evri_hse_v12'
  in_app       boolean not null default true,  -- the temp reads and signs it in ShiftReady
  sign_mode    text not null default 'document' check (sign_mode in ('document', 'every_page')),
  site_pages   integer[] not null default '{}', -- pages printed for the day-one paper sign-off
  archived_at  timestamptz,                  -- taken out of the pack; kept so signed packs still open
  created_at   timestamptz not null default now()
);
create index if not exists induction_docs_pack_idx on public.induction_docs (pack_id, position);

-- ---------- Sent to a temp ----------
create table if not exists public.temp_inductions (
  id             uuid primary key default gen_random_uuid(),
  temp_id        uuid not null references public.temps (id) on delete cascade,
  pack_id        uuid not null references public.induction_packs (id),
  doc_ids        uuid[] not null,            -- the pack exactly as it was when sent
  token          uuid not null unique default gen_random_uuid(),
  answers        jsonb not null default '{}', -- site, scope, start date, arrival time, safety footwear
  sent_by        uuid references public.profiles (id) on delete set null,
  sent_at        timestamptz not null default now(),
  started_at     timestamptz,
  signed_at      timestamptz,                -- temp finished every page and signature
  signed_ip      text,
  checked_at     timestamptz,                -- office checked the signatures: OK to go to site
  checked_by     uuid references public.profiles (id) on delete set null,
  site_signed_at timestamptz,                -- photo of the signed day-one sheet uploaded
  site_by_staff  uuid references public.profiles (id) on delete set null,
  site_by_supervisor uuid,                   -- references site_supervisors (added below)
  cancelled_at   timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists temp_inductions_temp_idx on public.temp_inductions (temp_id);

create table if not exists public.induction_marks (
  id            uuid primary key default gen_random_uuid(),
  induction_id  uuid not null references public.temp_inductions (id) on delete cascade,
  doc_id        uuid not null references public.induction_docs (id),
  page          integer not null,            -- 1-based page; 0 = signature for the whole document
  read_ok       boolean not null default false,
  understood_ok boolean not null default false,
  signature     text,                        -- finger-drawn signature or initials (PNG data URL)
  signed_name   text,
  at            timestamptz not null default now(),
  ip            text,
  user_agent    text,
  unique (induction_id, doc_id, page)
);

-- ---------- Site supervisor logins ----------
create table if not exists public.site_supervisors (
  id             uuid primary key default gen_random_uuid(),
  username       text not null,
  full_name      text not null,
  password_hash  text not null,               -- scrypt, set by the app
  client_id      uuid references public.clients (id) on delete set null,  -- only this client's shifts (blank = all)
  active         boolean not null default true,
  session_version integer not null default 1, -- bumped to sign them out everywhere
  last_login_at  timestamptz,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);
create unique index if not exists site_supervisors_username_key on public.site_supervisors (lower(username));
do $$ begin
  alter table public.temp_inductions add constraint temp_inductions_supervisor_fk
    foreign key (site_by_supervisor) references public.site_supervisors (id) on delete set null;
exception when duplicate_object then null; end $$;

-- The photo of the signed paper sheet is kept with the temp's other documents.
alter table public.temp_documents add column if not exists induction_id uuid references public.temp_inductions (id) on delete set null;
alter table public.temp_documents drop constraint if exists temp_documents_kind_check;
alter table public.temp_documents add constraint temp_documents_kind_check
  check (kind in ('passport', 'id', 'rtw_check', 'ni_proof', 'flt_licence', 'driving_licence', 'other', 'induction_site'));

-- ---------- Security: office staff only. Temps and supervisors go through the app's server. ----------
alter table public.induction_packs  enable row level security;
alter table public.induction_docs   enable row level security;
alter table public.temp_inductions  enable row level security;
alter table public.induction_marks  enable row level security;
alter table public.site_supervisors enable row level security;

drop policy if exists induction_packs_staff on public.induction_packs;
create policy induction_packs_staff on public.induction_packs for select to authenticated using (public.is_staff());
drop policy if exists induction_packs_admin on public.induction_packs;
create policy induction_packs_admin on public.induction_packs for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists induction_docs_staff on public.induction_docs;
create policy induction_docs_staff on public.induction_docs for select to authenticated using (public.is_staff());
drop policy if exists induction_docs_admin on public.induction_docs;
create policy induction_docs_admin on public.induction_docs for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists temp_inductions_staff_read on public.temp_inductions;
create policy temp_inductions_staff_read on public.temp_inductions for select to authenticated using (public.is_staff());
drop policy if exists temp_inductions_staff_insert on public.temp_inductions;
create policy temp_inductions_staff_insert on public.temp_inductions for insert to authenticated with check (public.is_staff());
drop policy if exists temp_inductions_staff_update on public.temp_inductions;
create policy temp_inductions_staff_update on public.temp_inductions for update to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists induction_marks_staff_read on public.induction_marks;
create policy induction_marks_staff_read on public.induction_marks for select to authenticated using (public.is_staff());

-- Supervisors' password hashes are never readable through the API: admins manage them through the app's server.
drop policy if exists site_supervisors_none on public.site_supervisors;
