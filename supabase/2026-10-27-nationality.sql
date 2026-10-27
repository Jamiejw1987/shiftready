-- ShiftReady: nationality on registration. Run once in Supabase SQL Editor. Safe to re-run.
alter table public.temp_profiles add column if not exists nationality text;

-- Mention nationality in the privacy notice (saved as a new version, only if the wording hasn't been changed already).
insert into public.app_documents (kind, version, title, body)
select 'privacy', d.version + 1, d.title,
       replace(d.body, '- Right to work information:', '- Your nationality and right to work information:')
from public.app_documents d
where d.kind = 'privacy'
  and d.version = (select max(version) from public.app_documents where kind = 'privacy')
  and d.body like '%- Right to work information:%';
