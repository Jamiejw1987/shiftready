-- ShiftReady: clients only see booked temps once they've confirmed. Run once in Supabase SQL Editor. Safe to re-run.
-- People a consultant booked and asked to confirm ("awaiting confirm") stay hidden from the client until they reply YES.

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
    and not o.awaiting_confirm
  join public.temps t on t.id = o.temp_id
  left join public.client_feedback f on f.offer_id = o.id
  where r.id = any (p_request_ids)
    and (public.is_staff() or public.portal_site_ok(r.site_id))
  order by t.first_name, t.last_name;
$$;
revoke execute on function public.portal_people(uuid[]) from public, anon;
grant execute on function public.portal_people(uuid[]) to authenticated, service_role;
