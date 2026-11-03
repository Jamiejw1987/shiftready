import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import { clientReport, reportRange } from '@/lib/clientReport';
import { PrintButton } from './PrintButton';

export const dynamic = 'force-dynamic';

const shift = (iso: string, n: number) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);

/** Internal report: pull it, check it, then share it with the client yourself. Nothing is sent automatically. */
export default async function ClientReportPage({ params, searchParams }: { params: { id: string }; searchParams: { from?: string; to?: string } }) {
  const { supabase } = await requireStaff();
  const { data: c } = await supabase.from('clients').select('id,name,is_test').eq('id', params.id).maybeSingle();
  if (!c) notFound();
  const { from, to } = reportRange(searchParams.from, searchParams.to);
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
  const r = await clientReport(supabase, c.id, from, to);
  const t = r.total;
  const tile = (label: string, value: string, sub?: string) => (
    <div className="pcard" style={{ gap: 4 }}><span className="l">{label}</span><span className="pc-when" style={{ fontSize: 30 }}>{value}</span>{sub && <span className="note">{sub}</span>}</div>
  );

  return (
    <section className="panel">
      <p className="note noprint" style={{ margin: '0 0 6px' }}><Link href={`/clients/${c.id}`}>← {c.name}</Link></p>
      <div className="phead">
        <div>
          <h1>{c.name}: shift report</h1>
          <p className="lede" style={{ margin: 0 }}>{fmtDate(from)} to {fmtDate(to)} · prepared by Staff Selection UK</p>
        </div>
        <div className="btnrow noprint">
          <Link className="btn ghost small" href={`?from=${shift(from, -days)}&to=${shift(to, -days)}`}>← Previous</Link>
          <Link className="btn ghost small" href={`?from=${shift(from, days)}&to=${shift(to, days)}`}>Next →</Link>
          <a className="btn ghost small" href={`/api/clients/${c.id}/report?from=${from}&to=${to}`}>Spreadsheet</a>
          <PrintButton />
        </div>
      </div>
      <form className="filters noprint" style={{ margin: '12px 0' }}>
        <div className="f"><label className="l" htmlFor="rf">From</label><input id="rf" type="date" name="from" defaultValue={from} /></div>
        <div className="f"><label className="l" htmlFor="rt">To</label><input id="rt" type="date" name="to" defaultValue={to} /></div>
        <div className="f" style={{ justifyContent: 'flex-end' }}><button className="btn ghost">Show</button></div>
      </form>
      {c.is_test && <p className="alert noprint" style={{ marginBottom: 12 }}>Test client: this data is left out of the main reports.</p>}
      <div className="pgrid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', margin: '12px 0' }}>
        {tile('Shifts requested', String(t.requests), t.cancelled ? `${t.cancelled} cancelled` : undefined)}
        {tile('People requested', String(t.requested))}
        {tile('People supplied', String(t.filled))}
        {tile('Fill rate', t.fillRate == null ? '-' : `${t.fillRate}%`)}
        {tile('No-shows', String(t.noShows), t.noShowRate == null ? undefined : `${t.noShowRate}% of people supplied`)}
        {tile('Average rating', t.avgStars == null ? '-' : `★ ${t.avgStars.toFixed(1)}`, t.rated ? `${t.rated} rating${t.rated === 1 ? '' : 's'}` : 'No ratings yet')}
        {tile('Asked not to return', String(t.blocked))}
      </div>
      <div className="tablewrap"><table className="cards">
        <thead><tr><th>Shift</th><th>Site</th><th className="num">Requested</th><th className="num">Supplied</th><th className="num">No-shows</th><th className="num">Rating</th></tr></thead>
        <tbody>
          {r.lines.map((l) => (
            <tr key={l.id} style={l.status === 'cancelled' ? { opacity: 0.55 } : undefined}>
              <td><b>{fmtDate(l.date)}</b> {l.start}-{l.end}<div className="note">{l.role}{l.status === 'cancelled' ? ' · cancelled' : ''}</div></td>
              <td data-l="Site">{l.site}</td>
              <td className="num" data-l="Requested">{l.requested || '-'}</td>
              <td className="num" data-l="Supplied">{l.status === 'cancelled' ? '-' : l.filled}</td>
              <td className="num" data-l="No-shows">{l.noShows || '-'}</td>
              <td className="num" data-l="Rating">{l.avgStars == null ? '-' : `★ ${l.avgStars.toFixed(1)}`}</td>
            </tr>
          ))}
          {!r.lines.length && <tr><td colSpan={6} className="note">No requests in these dates.</td></tr>}
        </tbody>
      </table></div>
      <p className="note noprint">To send as a PDF: press Print / Save as PDF and choose “Save as PDF”. Check the figures first. This report is never sent to the client automatically.</p>
    </section>
  );
}
