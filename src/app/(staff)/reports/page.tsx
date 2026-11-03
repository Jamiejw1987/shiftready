import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { addDays, monday, nice, rate, weekReport, type Row } from '@/lib/reports';

export const dynamic = 'force-dynamic';

export default async function ReportsPage({ searchParams }: { searchParams: { w?: string } }) {
  const { supabase } = await requireStaff({ admin: true });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const start = monday(searchParams.w && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.w) ? searchParams.w : today);
  const thisWeek = monday(today);
  const r = await weekReport(supabase, start);
  const t = r.total;
  const pct = rate(t);
  const maxDay = Math.max(1, ...r.byDay.map((d) => d.needed));

  const table = (title: string, rows: Row[], first: string) => (
    <section className="panel">
      <h2>{title}</h2>
      {!rows.length ? <p className="note">No shifts this week.</p> : (
        <div className="tablewrap"><table className="cards">
          <thead><tr><th>{first}</th><th className="num">Shifts</th><th className="num">Needed</th><th className="num">Filled</th><th className="num">Unfilled</th><th className="num">No-shows</th><th className="num">Fill rate</th></tr></thead>
          <tbody>{rows.map((x) => {
            const p = rate(x);
            return (
              <tr key={x.key}>
                <td><b>{x.label}</b>{(x.upcoming > 0 || x.cancelled > 0) && <div className="note">{[x.upcoming && `${x.upcoming} still to run`, x.cancelled && `${x.cancelled} cancelled`].filter(Boolean).join(' · ')}</div>}</td>
                <td className="num" data-l="Shifts">{x.shifts}</td>
                <td className="num" data-l="Needed">{x.needed}</td>
                <td className="num" data-l="Filled">{x.filled}</td>
                <td className="num" data-l="Unfilled">{x.unfilled || '-'}</td>
                <td className="num" data-l="No-shows">{x.noshows || '-'}</td>
                <td className="num" data-l="Fill rate">{p == null ? '-' : <span className={`pill ${p >= 95 ? 'ok' : p >= 80 ? 'warn' : 'bad'}`}>{p}%</span>}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
    </section>
  );

  return (
    <>
      <section className="panel">
        <div className="pl-nav">
          <Link className="btn small ghost" href={`/reports?w=${addDays(start, -7)}`} aria-label="Previous week">‹</Link>
          <div className="pl-title"><h2>Week of {nice(start, { day: 'numeric', month: 'short', year: 'numeric' })}</h2>
            <div className="note">{start === thisWeek ? 'This week · ' : ''}Mon {nice(start, { day: 'numeric', month: 'short' })} to Sun {nice(addDays(start, 6), { day: 'numeric', month: 'short' })}</div></div>
          <Link className="btn small ghost" href={`/reports?w=${addDays(start, 7)}`} aria-label="Next week">›</Link>
        </div>
        <div className="btnrow" style={{ justifyContent: 'center', marginTop: 12 }}>
          {start !== thisWeek && <Link className="btn small ghost" href="/reports">This week</Link>}
          <a className="btn small ghost" href={`/api/reports?w=${start}`}>Download CSV</a>
        </div>

        <div className="rp-stats">
          <div><span>Fill rate</span><b className={pct == null ? '' : pct >= 95 ? 'ok' : pct >= 80 ? 'warn' : 'bad'}>{pct == null ? '-' : `${pct}%`}</b></div>
          <div><span>Places filled</span><b>{t.filled}<small>/{t.needed}</small></b></div>
          <div><span>Unfilled</span><b className={t.unfilled ? 'bad' : ''}>{t.unfilled}</b></div>
          <div><span>No-shows</span><b className={t.noshows ? 'bad' : ''}>{t.noshows}</b></div>
          <div><span>Shifts run</span><b>{t.shifts}</b></div>
          <div><span>Cancelled</span><b>{t.cancelled}</b></div>
        </div>
        {t.upcoming > 0 && <p className="note" style={{ textAlign: 'center' }}>{t.upcoming} shift{t.upcoming > 1 ? 's' : ''} this week haven’t started yet, so they aren’t counted.</p>}

        <h3 style={{ margin: '18px 0 8px' }}>By day</h3>
        <div className="rp-days">
          {r.byDay.map((d) => (
            <Link key={d.key} href={`/planner?d=${d.key}`} className="rp-day" title={`${d.filled} filled, ${d.unfilled} unfilled, ${d.noshows} no-shows`}>
              <div className="rp-bar" style={{ height: 120 }}>
                {d.needed > 0 && <>
                  <i className="miss" style={{ height: `${((d.unfilled + d.noshows) / maxDay) * 100}%` }} />
                  <i className="fill" style={{ height: `${(d.filled / maxDay) * 100}%` }} />
                </>}
              </div>
              <span className="rp-num">{d.needed ? `${d.filled}/${d.needed}` : d.upcoming ? 'to run' : '–'}</span>
              <span className="rp-lbl">{d.label}</span>
            </Link>
          ))}
        </div>
        <div className="note rp-legend"><span><i className="fill" /> Filled</span><span><i className="miss" /> Unfilled or no-show</span></div>
      </section>
      {table('By client', r.byClient, 'Client')}
      {table('By consultant', r.byUser, 'Sent by')}
      <p className="note" style={{ textAlign: 'center' }}>Filled = booked and worked. Unfilled = places nobody was booked into. No-show = booked but didn’t turn up. Fill rate = filled ÷ needed. Shifts count once they’ve started.</p>
    </>
  );
}
