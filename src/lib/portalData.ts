import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { hasStarted, hoursUntil } from './clients';

export type Person = {
  offerId: string; first: string; last: string; beenBefore: boolean; noShowByOffice: boolean;
  attended: boolean | null; stars: number | null; returnToSite: boolean | null; comment: string | null;
};
export type PortalRequest = {
  id: string; date: string; start: string; end: string; role: string; headcount: number; notes: string | null;
  status: 'submitted' | 'acknowledged' | 'cancelled'; urgent: boolean; siteId: string; siteName: string;
  postedBy: string | null; cancelReason: string | null; cancelledByClient: boolean | null; createdAt: string;
  hasShift: boolean; filled: number; people: Person[]; started: boolean; hoursToStart: number;
};

export function stage(r: PortalRequest): { label: string; tone: 'ok' | 'warn' | 'mute' | 'bad' | 'blue' } {
  if (r.status === 'cancelled') return { label: 'Cancelled', tone: 'bad' };
  if (r.started) return { label: r.filled ? 'Completed' : 'Not filled', tone: 'mute' };
  if (r.filled >= r.headcount) return { label: 'Filled', tone: 'ok' };
  if (r.filled > 0) return { label: `${r.filled} of ${r.headcount} filled`, tone: 'warn' };
  if (r.status === 'acknowledged') return { label: 'Acknowledged', tone: 'blue' };
  return { label: 'Submitted', tone: 'warn' };
}

/**
 * Everything the client portal shows, for one client. `db` is either the signed-in client user (the database's
 * rules limit what they see) or an office user for "View as client". `names` is the service-role client, used only
 * to show which colleague posted each request.
 */
export async function loadRequests(db: SupabaseClient, names: SupabaseClient, clientId: string, siteIds: string[], range: { from: string; to?: string; ids?: string[] }) {
  if (!siteIds.length) return [] as PortalRequest[];
  let q = db.from('client_requests')
    .select('id,request_date,start_time,end_time,role,headcount,notes,status,is_urgent,site_id,created_by,cancel_reason,cancelled_by_client,created_at,client_sites(name)')
    .eq('client_id', clientId).in('site_id', siteIds);
  if (range.ids) q = q.in('id', range.ids);
  else {
    q = q.gte('request_date', range.from);
    if (range.to) q = q.lte('request_date', range.to);
  }
  const { data: rows } = await q.order('request_date').order('start_time');
  const list = rows ?? [];
  if (!list.length) return [];
  const ids = list.map((r) => r.id);
  const creators = [...new Set(list.map((r) => r.created_by).filter(Boolean))] as string[];
  const [{ data: people }, { data: who }, { data: made }] = await Promise.all([
    db.rpc('portal_people', { p_request_ids: ids }),
    creators.length ? names.from('client_users').select('id,full_name,email').in('id', creators) : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string }[] }),
    // Which requests have a shift yet. A client user can't read shifts, so this asks with the service-role client, by request id only.
    names.from('shifts').select('request_id').in('request_id', ids).neq('status', 'cancelled'),
  ]);
  const withShift = new Set((made ?? []).map((m) => m.request_id));
  type Row = { request_id: string; offer_id: string; first_name: string; last_name: string; been_before: boolean; no_show_by_office: boolean; attended: boolean | null; stars: number | null; return_to_site: boolean | null; comment: string | null };
  const byReq = new Map<string, Person[]>();
  for (const p of (people ?? []) as Row[]) {
    byReq.set(p.request_id, [...(byReq.get(p.request_id) ?? []), {
      offerId: p.offer_id, first: p.first_name, last: p.last_name, beenBefore: p.been_before, noShowByOffice: p.no_show_by_office,
      attended: p.attended, stars: p.stars, returnToSite: p.return_to_site, comment: p.comment,
    }]);
  }
  return list.map((r) => {
    const ps = byReq.get(r.id) ?? [];
    const w = { request_date: r.request_date, start_time: r.start_time };
    const c = (who ?? []).find((x) => x.id === r.created_by);
    return {
      id: r.id, date: r.request_date, start: r.start_time.slice(0, 5), end: r.end_time.slice(0, 5), role: r.role, headcount: r.headcount, notes: r.notes,
      status: r.status, urgent: r.is_urgent, siteId: r.site_id, siteName: (r.client_sites as unknown as { name: string } | null)?.name ?? '',
      postedBy: c ? c.full_name || c.email : null, cancelReason: r.cancel_reason, cancelledByClient: r.cancelled_by_client, createdAt: r.created_at,
      hasShift: withShift.has(r.id), filled: ps.filter((p) => !p.noShowByOffice).length, people: ps, started: hasStarted(w), hoursToStart: hoursUntil(w),
    } as PortalRequest;
  });
}
