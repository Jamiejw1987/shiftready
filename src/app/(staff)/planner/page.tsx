import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { hhmm } from '@/lib/format';
import { AutoRefresh } from './AutoRefresh';

export const dynamic = 'force-dynamic';

type Offer = { status: string; awaiting_confirm: boolean | null; checkin_reply: string | null; checkin_sent_at: string | null; temps: { first_name: string; last_name: string } | null };
type Shift = { id: string; client: string; site: string; site_postcode: string; job_type: string; shift_date: string; start_time: string; end_time: string; heads: number; offers: Offer[] | null };

const SLOTS = [
  { key: 'early', label: 'Early', hint: 'Starts before 11:00' },
  { key: 'late', label: 'Late', hint: '11:00 to 17:59' },
  { key: 'night', label: 'Night', hint: '18:00 onwards' },
] as const;
const slotOf = (t: string) => { const h = +t.slice(0, 2); return h < 11 ? 'early' : h < 18 ? 'late' : 'night'; };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string | undefined, fallback: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fallback);
const addDays = (s: string, n: number) => { const d = new Date(`${s}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const monday = (s: string) => addDays(s, -((new Date(`${s}T12:00:00Z`).getUTCDay() + 6) % 7));
const nice = (s: string, opts: Intl.DateTimeFormatOptions) => new Date(`${s}T12:00:00Z`).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });

const filledOf = (s: Shift) => (s.offers ?? []).filter((o) => o.status === 'accepted').length;
const siteKey = (s: Shift) => `${s.client}|${s.site_postcode}`;

export default async function PlannerPage({ searchParams }: { searchParams: { d?: string; view?: string } }) {
  const { supabase } = await requireStaff();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const day = parse(searchParams.d, today);
  const week = searchParams.view === 'week';
  const from = week ? monday(day) : day;
  const to = week ? addDays(from, 6) : day;

  const { data } = await supabase.from('shifts')
    .select('id,client,site,site_postcode,job_type,shift_date,start_time,end_time,heads,offers(status,awaiting_confirm,checkin_reply,checkin_sent_at,temps(first_name,last_name))')
    .gte('shift_date', from).lte('shift_date', to).neq('status', 'cancelled')
    .order('start_time');
  const shifts = (data ?? []) as unknown as Shift[];

  // Rows: one per depot (client + postcode), in name order.
  const sites = [...new Map(shifts.map((s) => [siteKey(s), { key: siteKey(s), client: s.client, postcode: s.site_postcode }])).values()]
    .sort((a, b) => a.client.localeCompare(b.client) || a.postcode.localeCompare(b.postcode));

  const need = shifts.reduce((n, s) => n + s.heads, 0);
  const got = shifts.reduce((n, s) => n + Math.min(filledOf(s), s.heads), 0);
  const short = shifts.filter((s) => filledOf(s) < s.heads).length;

  const step = week ? 7 : 1;
  const link = (d: string, v = week) => `/planner?d=${d}${v ? '&view=week' : ''}`;
  const title = week
    ? `Week of ${nice(from, { day: 'numeric', month: 'short' })}`
    : `${day === today ? 'Today · ' : day === addDays(today, 1) ? 'Tomorrow · ' : ''}${nice(day, { weekday: 'long', day: 'numeric', month: 'short' })}`;

  const person = (o: Offer) => {
    const name = o.temps ? `${o.temps.first_name} ${o.temps.last_name}`.trim() : 'Unknown';
    const mark = o.status === 'noshow' ? ['bad', 'no-show'] : o.checkin_reply === 'yes' ? ['ok', '✓'] : o.checkin_reply === 'no' ? ['bad', 'can’t make it'] : o.checkin_sent_at ? ['warn', '?'] : o.awaiting_confirm ? ['warn', 'to confirm'] : null;
    return <div key={name + o.status} className="pl-name">{name}{mark && <span className={`pl-mark ${mark[0]}`}> {mark[1]}</span>}</div>;
  };

  return (
    <section className="panel">
      <AutoRefresh />
      <div className="pl-head">
        <div className="btnrow pl-toggle">
          <Link className={`btn small ${week ? 'ghost' : 'blue'}`} href={link(day, false)}>Day</Link>
          <Link className={`btn small ${week ? 'blue' : 'ghost'}`} href={link(day, true)}>Week</Link>
          {day !== today && <Link className="btn small ghost" href={link(today)}>Today</Link>}
        </div>
        <div className="pl-nav">
          <Link className="btn small ghost" href={link(addDays(day, -step))} aria-label={week ? 'Previous week' : 'Previous day'}>‹</Link>
          <div className="pl-title"><h2>{title}</h2>
            <div className="note">{shifts.length ? `${got}/${need} places filled · ${short ? `${short} shift${short > 1 ? 's' : ''} short` : 'all filled'}` : 'No shifts'}{week && shifts.length ? ' · tap a day to open it' : ''}</div></div>
          <Link className="btn small ghost" href={link(addDays(day, step))} aria-label={week ? 'Next week' : 'Next day'}>›</Link>
        </div>
      </div>

      {!shifts.length ? <p className="lede" style={{ marginTop: 16 }}>No shifts {week ? 'this week' : 'on this day'}. <Link href="/shifts">Create one</Link>.</p> : week ? (
        <div className="pl-scroll"><table className="pl pl-week">
          <thead><tr><th className="pl-site"></th>{Array.from({ length: 7 }, (_, i) => { const d = addDays(from, i); return <th key={d} className={d === today ? 'pl-today' : ''}>{nice(d, { weekday: 'short' })}<br />{nice(d, { day: 'numeric' })}</th>; })}</tr></thead>
          <tbody>{sites.map((site) => (
            <tr key={site.key}><td className="pl-site">{site.client}<div className="note">{site.postcode}</div></td>
              {Array.from({ length: 7 }, (_, i) => {
                const d = addDays(from, i);
                const list = shifts.filter((s) => siteKey(s) === site.key && s.shift_date === d);
                if (!list.length) return <td key={d} className="pl-cell none">–</td>;
                const n = list.reduce((a, s) => a + s.heads, 0), f = list.reduce((a, s) => a + Math.min(filledOf(s), s.heads), 0);
                return <td key={d} className={`pl-cell ${f < n ? 'short' : 'full'}`}><Link href={link(d, false)} className="pl-fill">{f}/{n}{list.length > 1 && <span className="pl-sub">{list.length} shifts</span>}</Link></td>;
              })}</tr>
          ))}</tbody>
        </table></div>
      ) : (
        <div className="pl-scroll"><table className="pl">
          <thead><tr><th className="pl-site"></th>{SLOTS.map((s) => <th key={s.key} title={s.hint}>{s.label}</th>)}</tr></thead>
          <tbody>{sites.map((site) => (
            <tr key={site.key}><td className="pl-site">{site.client}<div className="note">{site.postcode}</div></td>
              {SLOTS.map((slot) => {
                const list = shifts.filter((s) => siteKey(s) === site.key && slotOf(s.start_time) === slot.key);
                if (!list.length) return <td key={slot.key} className="pl-cell none">–</td>;
                return <td key={slot.key} className="pl-cell stack">{list.map((s) => {
                  const f = filledOf(s);
                  const names = (s.offers ?? []).filter((o) => o.status === 'accepted' || o.status === 'noshow');
                  const standby = (s.offers ?? []).filter((o) => o.status === 'standby').length;
                  return (
                    <Link key={s.id} href={`/shifts/${s.id}`} className={`pl-shift ${f < s.heads ? 'short' : 'full'}`}>
                      <div className="pl-top"><b>{hhmm(s.start_time)}–{hhmm(s.end_time)}</b><span>{f}/{s.heads}</span></div>
                      <div className="pl-job">{s.job_type}</div>
                      {names.map(person)}
                      {f < s.heads && <div className="pl-gap">{s.heads - f} to fill{standby ? ` · ${standby} on standby` : ''}</div>}
                    </Link>
                  );
                })}</td>;
              })}</tr>
          ))}</tbody>
        </table></div>
      )}
      {!week && shifts.length > 0 && <p className="note" style={{ marginTop: 10 }}>✓ confirmed coming · ? check-in sent, no reply yet · tap a shift to open it. Updates every 30 seconds.</p>}
    </section>
  );
}
