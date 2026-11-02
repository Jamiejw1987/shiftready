-- ================= Job board applications (CV-Library DirectApply) =================
-- Every application a job board pushes to ShiftReady, and what we did with it.
create table if not exists public.job_applications (
  id uuid primary key default gen_random_uuid(),
  source text not null,                       -- cv-library
  external_id text,                           -- the board's own candidate/application id
  job_ref text,
  job_title text,
  first_name text,
  last_name text,
  email text,
  mobile text,                                -- +44 format when it was a valid UK mobile
  phone_raw text,
  postcode text,
  town text,
  cv_path text,                               -- in the private "documents" bucket
  cv_name text,
  temp_id uuid references public.temps(id) on delete set null,
  outcome text not null default 'saved',      -- texted | already_registered | resent | no_mobile | opted_out | not_sent | failed
  detail text,
  payload jsonb,                              -- what the board sent (without the CV file), for troubleshooting
  created_at timestamptz not null default now()
);
create index if not exists job_applications_created on public.job_applications (created_at desc);
create unique index if not exists job_applications_dedupe on public.job_applications (source, external_id, job_ref) where external_id is not null;
alter table public.job_applications enable row level security;
drop policy if exists job_applications_staff on public.job_applications;
create policy job_applications_staff on public.job_applications for select using (public.is_staff());

-- Settings staff can read and admins can change (the text applicants get).
create table if not exists public.app_settings (key text primary key, value text not null, updated_at timestamptz not null default now(), updated_by uuid);
alter table public.app_settings enable row level security;
drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings for select using (public.is_staff());
drop policy if exists app_settings_write on public.app_settings;
create policy app_settings_write on public.app_settings for all using (public.is_admin()) with check (public.is_admin());

-- The private key that goes in the address you give CV-Library.
insert into public.app_secrets (name, value) values ('apply_key', encode(gen_random_bytes(18), 'hex'))
on conflict (name) do nothing;

-- Let CVs in Word and text formats be stored as well as PDFs and photos.
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/rtf', 'text/plain']
where id = 'documents';
