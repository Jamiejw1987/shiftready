import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { shiftWhen } from '@/lib/format';
import { ShiftForm } from './ShiftForm';
import { DeleteShift } from './DeleteShift';
import { seriesWhen } from '@/lib/series';
import { WeekActions } from './series/[id]/WeekActions';

export const dynamic = 'force-dynamic';

type Shift = { id: string; client: string; job_type: string; site_postcode: string; shift_date: string; start_time: string; end_time: string; heads: number; status: string; sent_by: string | null; series_id: string | null; offers: { status: string }[] | null };

export default async function ShiftsPage() {
  const { supabase, profile } = await requireStaff();
  const since = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
  const [{ data: rows }, { data: users }] = await Promise.all([
    supabase.from('shifts').select('id,client,job_type,site_postcode,shift_date,start_time,end_time,heads,status,sent_by,series_id,offers(status)').gte('shift_date', since).order('shift_date').order('start_time'),
    supabase.from('profiles').select('id,full_name'),
  ]);
  const name = (id: string | null) => users?.find((u) => u.id === id)?.full_name ?? '';
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const admin = profile.role === 'admin';
  const shifts = (rows ?? []) as Shift[];
  const singles = shifts.filter((s) => !s.series_id);
  const upcoming = singles.filter((s) => s.shift_date >= today && s.status !== 'cancelled');
  const old = singles.filter((s) => s.shift_date < today || s.status === 'cancelled').reverse();
  // Weekly shifts show as one row each.
  const groups = new Map<string, Shift[]>();
  for (const s of shifts) if (s.series_id) groups.set(s.series_id, [...(groups.get(s.series_id) ?? []), s]);
  const weeks = [...groups.entries()].map(([id, days]) => ({ id, days, live: days.some((d) => d.shift_date >= today && d.status !== 'cancelled') }));
  const weekRows = (live: boolean) => weeks.filter((w) => w.live === live).map((w) => {
    const live = w.days.filter((d) => d.status !== 'cancelled');
    const booked = live.reduce((n, d) => n + (d.offers ?? []).filter((o) => o.status === 'accepted').length, 0);
    const heads = live.reduce((n, d) => n + d.heads, 0);
    const d0 = w.days[0];
    return (
      <tr key={w.id}>
        <td><Link href={`/shifts/series/${w.id}`}><b>{d0.client}</b></Link> <span className="pill blue">{w.days.length} days</span><div className="note">{d0.job_type} · {d0.site_postcode}</div></td>
        <td data-l="When">{seriesWhen(w.days)}</td>
        <td className="num" data-l="Filled">{booked}/{heads}</td>
        <td className="num" data-l="Standby">-</td>
        <td data-l="Sent by">{name(d0.sent_by)}</td>
        <td><span className={`pill ${booked >= heads && heads ? 'ok' : live.length ? 'warn' : 'bad'}`}>{!live.length ? 'Cancelled' : booked >= heads ? 'Filled' : `${heads - booked} places to fill`}</span></td>
        {admin && <td>{!live.length || booked === 0 ? <WeekActions seriesId={w.id} canCancel={false} admin redirectAfterDelete={false} /> : null}</td>}
      </tr>
    );
  });

  const table = (list: Shift[], past: boolean, extra: React.ReactNode[] = []) => (
    <div className="tablewrap"><table className="cards">
      <thead><tr><th>Shift</th><th>When</th><th>Filled</th><th>Standby</th><th>Sent by</th><th>Status</th>{admin && <th></th>}</tr></thead>
      <tbody>
        {extra}
        {list.map((s) => {
          const offers = s.offers ?? [];
          const filled = offers.filter((o) => o.status === 'accepted').length;
          const standby = offers.filter((o) => o.status === 'standby').length;
          const worked = offers.some((o) => o.status === 'accepted' || o.status === 'noshow');
          const pill = s.status === 'cancelled' ? ['bad', 'Cancelled'] : filled >= s.heads ? ['ok', 'Filled'] : past ? ['mute', 'Past'] : ['warn', `${s.heads - filled} to fill`];
          return (
            <tr key={s.id}>
              <td><Link href={`/shifts/${s.id}`}><b>{s.client}</b></Link><div className="note">{s.job_type} · {s.site_postcode}</div></td>
              <td data-l="When">{shiftWhen(s)}</td>
              <td className="num" data-l="Filled">{filled}/{s.heads}</td>
              <td className="num" data-l="Standby">{standby}</td>
              <td data-l="Sent by">{name(s.sent_by)}</td>
              <td><span className={`pill ${pill[0]}`}>{pill[1]}</span></td>
              {admin && <td>{(!worked || s.status === 'cancelled') && <DeleteShift id={s.id} />}</td>}
            </tr>
          );
        })}
        {!list.length && !extra.length && <tr><td colSpan={7} className="note">{past ? 'Nothing in the last 60 days.' : 'No upcoming shifts. Create one above.'}</td></tr>}
      </tbody>
    </table></div>
  );

  return (
    <>
      <ShiftForm />
      <section className="panel">
        <h2>Upcoming shifts</h2>
        <p className="lede">Open one to see the live board.</p>
        {table(upcoming, false, weekRows(true))}
      </section>
      <section className="panel">
        <details>
          <summary>Past and cancelled shifts ({old.length + weeks.filter((w) => !w.live).length})</summary>
          <p className="lede" style={{ marginTop: 10 }}>The last 60 days.{admin ? ' Admins can delete cancelled shifts and shifts nobody was booked on, such as tests. Shifts people worked are kept as a record.' : ''}</p>
          {table(old, true, weekRows(false))}
        </details>
      </section>
    </>
  );
}
