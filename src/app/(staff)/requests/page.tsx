import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { fmtDateTime } from '@/lib/format';
import { holidayRange } from '@/lib/texts';
import { displayMobile } from '@/lib/phone';
import { Decide } from './Decide';

export const dynamic = 'force-dynamic';

type Row = {
  id: string; kind: 'holiday' | 'p45'; status: string; start_date: string | null; end_date: string | null; days: number | null;
  last_day: string | null; delivery: string | null; note: string | null; response_note: string | null; handled_by: string | null; handled_at: string | null; created_at: string;
  temps: { id: string; first_name: string; last_name: string; mobile: string; temp_profiles: { email: string | null; address1: string | null; address2: string | null; town: string | null } | null; postcode: string | null } | null;
};
const STATUS: Record<string, [string, string]> = { pending: ['warn', 'Waiting'], approved: ['ok', 'Approved'], declined: ['bad', 'Declined'], done: ['ok', 'Sent'] };
const day = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export default async function RequestsPage() {
  const { supabase, profile } = await requireStaff();
  const canDecide = profile.role === 'admin' || (profile as unknown as { payroll?: boolean }).payroll === true;
  const [{ data: rows }, { data: users }] = await Promise.all([
    supabase.from('temp_requests')
      .select('id,kind,status,start_date,end_date,days,last_day,delivery,note,response_note,handled_by,handled_at,created_at,temps(id,first_name,last_name,mobile,postcode,temp_profiles(email,address1,address2,town))')
      .order('created_at', { ascending: false }).limit(300),
    supabase.from('profiles').select('id,full_name'),
  ]);
  const all = (rows ?? []) as unknown as Row[];
  const open = all.filter((r) => r.status === 'pending').reverse();
  const done = all.filter((r) => r.status !== 'pending');
  const name = (id: string | null) => users?.find((u) => u.id === id)?.full_name ?? '';

  const what = (r: Row) => r.kind === 'holiday'
    ? <><b>Holiday</b> · {holidayRange(r.start_date!, r.end_date!)} · {Number(r.days)} day{Number(r.days) === 1 ? '' : 's'}</>
    : <><b>P45</b> · last day {r.last_day ? day(r.last_day) : '-'} · by {r.delivery}</>;
  const sendTo = (r: Row) => {
    const p = r.temps?.temp_profiles;
    if (r.kind !== 'p45' || !p) return null;
    return r.delivery === 'post' ? [p.address1, p.address2, p.town, r.temps?.postcode].filter(Boolean).join(', ') : p.email;
  };

  return (
    <>
      <section className="panel">
        <h1>Requests</h1>
        <p className="lede">Holiday and P45 requests from temps. Payroll contacts get a text for each new one{canDecide ? '' : '. Only payroll and admins can answer them'}. The temp is texted with your answer.</p>
        <div className="tablewrap"><table className="cards">
          <thead><tr><th>Temp</th><th>Request</th><th>Sent</th><th></th></tr></thead>
          <tbody>
            {open.map((r) => (
              <tr key={r.id}>
                <td>{r.temps ? <Link href={`/temps/${r.temps.id}`}><b>{r.temps.first_name} {r.temps.last_name}</b></Link> : 'Deleted temp'}<div className="note">{r.temps && displayMobile(r.temps.mobile)}</div></td>
                <td className="full">{what(r)}{r.note && <div className="note">“{r.note}”</div>}{sendTo(r) && <div className="note">Send to: {sendTo(r)}</div>}</td>
                <td data-l="Sent">{fmtDateTime(r.created_at)}</td>
                <td className="full">{canDecide ? <Decide id={r.id} kind={r.kind} /> : <span className="pill warn">Waiting</span>}</td>
              </tr>
            ))}
            {!open.length && <tr><td colSpan={4} className="note">Nothing waiting.</td></tr>}
          </tbody>
        </table></div>
      </section>
      <section className="panel">
        <h2>Answered</h2>
        <div className="tablewrap"><table className="cards">
          <thead><tr><th>Temp</th><th>Request</th><th>Answer</th><th>By</th></tr></thead>
          <tbody>
            {done.map((r) => (
              <tr key={r.id}>
                <td><b>{r.temps ? `${r.temps.first_name} ${r.temps.last_name}` : 'Deleted temp'}</b></td>
                <td className="full">{what(r)}</td>
                <td data-l="Answer"><span className={`pill ${STATUS[r.status][0]}`}>{STATUS[r.status][1]}</span>{r.response_note && <div className="note">{r.response_note}</div>}</td>
                <td className="by" data-l="By">{name(r.handled_by)}<small>{r.handled_at ? fmtDateTime(r.handled_at) : ''}</small></td>
              </tr>
            ))}
            {!done.length && <tr><td colSpan={4} className="note">None yet.</td></tr>}
          </tbody>
        </table></div>
      </section>
    </>
  );
}
