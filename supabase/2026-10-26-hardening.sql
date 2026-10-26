-- Security tightening after review (26 Oct 2026). Run once in Supabase > SQL Editor.
-- Safe to re-run. Already included in schema.sql for new installs.

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
