import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export type ReportLine = {
  id: string; date: string; start: string; end: string; site: string; role: string; status: string;
  requested: number; filled: number; noShows: number; rated: number; avgStars: number | null;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Default range: last Monday to Sunday. */
export function reportRange(from?: string, to?: string) {
  if (from && to && DATE.test(from) && DATE.test(to) && from <= to) return { from, to };
  const t = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' }) + 'T12:00:00Z');
  const mon = new Date(t.getTime() - ((t.getUTCDay() + 6) % 7) * 864e5 - 7 * 864e5);
  return { from: iso(mon), to: iso(new Date(mon.getTime() + 6 * 864e5)) };
}

/** Requests, fill rate, no-shows and ratings for one client over a date range. Internal only. */
export async function clientReport(db: SupabaseClient, clientId: string, from: string, to: string) {
  const [{ data: reqs }, { data: blocks }] = await Promise.all([
    db.from('client_requests').select('id,request_date,start_time,end_time,role,headcount,status,client_sites(name)')
      .eq('client_id', clientId).gte('request_date', from).lte('request_date', to).order('request_date').order('start_time'),
    db.from('client_blocks').select('id').eq('client_id', clientId).gte('created_at', `${from}T00:00:00Z`).lte('created_at', `${to}T23:59:59Z`),
  ]);
  const ids = (reqs ?? []).map((r) => r.id);
  const { data: shifts } = ids.length ? await db.from('shifts').select('id,request_id,status').in('request_id', ids) : { data: [] as { id: string; request_id: string; status: string }[] };
  const live = (shifts ?? []).filter((s) => s.status !== 'cancelled');
  const { data: offers } = live.length ? await db.from('offers').select('id,shift_id,status').in('shift_id', live.map((s) => s.id)).in('status', ['accepted', 'noshow']) : { data: [] as { id: string; shift_id: string; status: string }[] };
  const { data: fb } = offers?.length ? await db.from('client_feedback').select('offer_id,attended,stars').in('offer_id', offers.map((o) => o.id)) : { data: [] as { offer_id: string; attended: boolean | null; stars: number | null }[] };

  const lines: ReportLine[] = (reqs ?? []).map((r) => {
    const sh = live.filter((s) => s.request_id === r.id).map((s) => s.id);
    const os = (offers ?? []).filter((o) => sh.includes(o.shift_id));
    const f = (fb ?? []).filter((x) => os.some((o) => o.id === x.offer_id));
    const noShows = os.filter((o) => o.status === 'noshow' || f.some((x) => x.offer_id === o.id && x.attended === false)).length;
    const stars = f.filter((x) => x.stars).map((x) => x.stars!);
    return {
      id: r.id, date: r.request_date, start: r.start_time.slice(0, 5), end: r.end_time.slice(0, 5),
      site: (r.client_sites as unknown as { name: string } | null)?.name ?? '', role: r.role, status: r.status,
      requested: r.status === 'cancelled' ? 0 : r.headcount, filled: r.status === 'cancelled' ? 0 : os.length, noShows,
      rated: stars.length, avgStars: stars.length ? stars.reduce((a, b) => a + b, 0) / stars.length : null,
    };
  });
  const active = lines.filter((l) => l.status !== 'cancelled');
  const requested = active.reduce((n, l) => n + l.requested, 0);
  const filled = active.reduce((n, l) => n + Math.min(l.filled, l.requested), 0);
  const noShows = active.reduce((n, l) => n + l.noShows, 0);
  const allStars = (fb ?? []).filter((x) => x.stars).map((x) => x.stars!);
  return {
    lines,
    total: {
      requests: active.length, cancelled: lines.length - active.length, requested, filled,
      fillRate: requested ? Math.round((filled / requested) * 100) : null,
      noShows, noShowRate: filled ? Math.round((noShows / filled) * 100) : null,
      rated: allStars.length, avgStars: allStars.length ? allStars.reduce((a, b) => a + b, 0) / allStars.length : null,
      blocked: (blocks ?? []).length,
    },
  };
}

export function reportCsv(lines: ReportLine[]) {
  const q = (v: string | number | null) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ['Date', 'Start', 'Finish', 'Site', 'Type of work', 'Status', 'Requested', 'Filled', 'No-shows', 'Ratings', 'Average stars'];
  const rows = lines.map((l) => [l.date, l.start, l.end, l.site, l.role, l.status, l.requested, l.filled, l.noShows, l.rated, l.avgStars == null ? '' : l.avgStars.toFixed(1)]);
  return [head, ...rows].map((r) => r.map(q).join(',')).join('\r\n');
}
