-- Run AFTER schema.sql, and after creating your own login in
-- Supabase > Authentication > Users > Add user (tick "Auto confirm user").
-- Change the name and email below to match that login, then Run.

insert into public.profiles (id, full_name, email, role)
select id, 'Jamie Wood', email, 'admin'
from auth.users
where email = 'jamie@staffselectionuk.com'
on conflict (id) do update set role = 'admin', active = true;
