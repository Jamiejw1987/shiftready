import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export type ReportShift = {
  id: string; client: string; site_postcode: string; job_type: string; shift_date: string; start_time: string; end_time: string;
  heads: number; status: string; sent_by: string | null; offers: { status: string }[] | null;
};
export type Row = { key: string; label: string; shifts: number; needed: number; filled: number; noshows: number; unfilled: number; upcoming: number; cancelled: number };

const iso = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (s: string, n: number) => { const d = new Date(`${s}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
export const monday = (s: string) => addDays(s, -((new Date(`${s}T12:00:00Z`).getUTCDay() + 6) % 7));
export const nice = (s: string, o: Intl.DateTimeFormatOptions) => new Date(`${s}T12:00:00Z`).toLocaleDateString('en-GB', { ...o, timeZone: 'UTC' });

/**
 * A shift counts once it has started (London time). Before that it's "upcoming", not missed.
 * filled = accepted (worked), noshows = booked but didn't turn up, unfilled = places nobody was booked into.
 */
export async function weekReport(db: SupabaseClient, weekStart: string) {
  const to = addDays(weekStart, 6);
  const [{ data }, { data: users }, { data: tests }] = await Promise.all([
    db.from('shifts').select('id,client,client_id,site_postcode,job_type,shift_date,start_time,end_time,heads,status,sent_by,offers(status)')
      .gte('shift_date', weekStart).lte('shift_date', to).order('shift_date').order('start_time'),
    db.from('profiles').select('id,full_name'),
    db.from('clients').select('id').eq('is_test', true),
  ]);
  // Demo clients set up to try the portal are left out.
  const test = new Set((tests ?? []).map((c) => c.id));
  const shifts = ((data ?? []) as (ReportShift & { client_id: string | null })[]).filter((s) => !s.client_id || !test.has(s.client_id));
  const now = new Date();
  const today = now.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const nowTime = now.toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour12: false }).slice(0, 5);
  const started = (s: ReportShift) => s.shift_date < today || (s.shift_date === today && s.start_time.slice(0, 5) <= nowTime);
  const name = (id: string | null) => users?.find((u) => u.id === id)?.full_name || 'Unknown';

  const blank = (key: string, label: string): Row => ({ key, label, shifts: 0, needed: 0, filled: 0, noshows: 0, unfilled: 0, upcoming: 0, cancelled: 0 });
  const total = blank('all', 'All');
  const byClient = new Map<string, Row>(), byUser = new Map<string, Row>(), byDay = new Map<string, Row>();
  for (let i = 0; i < 7; i++) { const d = addDays(weekStart, i); byDay.set(d, blank(d, nice(d, { weekday: 'short', day: 'numeric' }))); }

  const lines: string[][] = [];
  for (const s of shifts) {
    const rows = [
      total,
      byClient.get(`${s.client}|${s.site_postcode}`) ?? byClient.set(`${s.client}|${s.site_postcode}`, blank(`${s.client}|${s.site_postcode}`, `${s.client} (${s.site_postcode})`)).get(`${s.client}|${s.site_postcode}`)!,
      byUser.get(s.sent_by ?? '-') ?? byUser.set(s.sent_by ?? '-', blank(s.sent_by ?? '-', name(s.sent_by))).get(s.sent_by ?? '-')!,
      byDay.get(s.shift_date)!,
    ];
    const offers = s.offers ?? [];
    const filled = Math.min(offers.filter((o) => o.status === 'accepted').length, s.heads);
    const noshows = offers.filter((o) => o.status === 'noshow').length;
    const unfilled = Math.max(0, s.heads - filled - noshows);
    let state = 'Completed';
    for (const r of rows) {
      if (s.status === 'cancelled') { r.cancelled++; continue; }
      if (!started(s)) { r.upcoming++; continue; }
      r.shifts++; r.needed += s.heads; r.filled += filled; r.noshows += noshows; r.unfilled += unfilled;
    }
    if (s.status === 'cancelled') state = 'Cancelled'; else if (!started(s)) state = 'Upcoming';
    lines.push([s.shift_date, s.start_time.slice(0, 5), s.end_time.slice(0, 5), s.client, s.site_postcode, s.job_type, name(s.sent_by), state,
      String(s.heads), state === 'Completed' ? String(filled) : '', state === 'Completed' ? String(noshows) : '', state === 'Completed' ? String(unfilled) : '']);
  }
  const sort = (m: Map<string, Row>) => [...m.values()].sort((a, b) => b.needed - a.needed || a.label.localeCompare(b.label));
  return { total, byClient: sort(byClient), byUser: sort(byUser), byDay: [...byDay.values()], lines };
}

export const rate = (r: Row) => (r.needed ? Math.round((r.filled / r.needed) * 100) : null);

export function toCsv(lines: string[][]) {
  const head = ['Date', 'Start', 'End', 'Client', 'Postcode', 'Job', 'Sent by', 'Status', 'Needed', 'Filled', 'No-shows', 'Unfilled'];
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : /^[=+\-@]/.test(v) ? `'${v}` : v);
  return [head, ...lines].map((l) => l.map(esc).join(',')).join('\r\n');
}
