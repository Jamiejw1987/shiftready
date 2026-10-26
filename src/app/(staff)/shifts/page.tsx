import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { shiftWhen } from '@/lib/format';
import { ShiftForm } from './ShiftForm';
import { DeleteShift } from './DeleteShift';

export const dynamic = 'force-dynamic';

type Shift = { id: string; client: string; job_type: string; site_postcode: string; shift_date: string; start_time: string; end_time: string; heads: number; status: string; sent_by: string | null; offers: { status: string }[] | null };

export default async function ShiftsPage() {
  const { supabase, profile } = await requireStaff();
  const since = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
  const [{ data: rows }, { data: users }] = await Promise.all([
    supabase.from('shifts').select('id,client,job_type,site_postcode,shift_date,start_time,end_time,heads,status,sent_by,offers(status)').gte('shift_date', since).order('shift_date').order('start_time'),
    supabase.from('profiles').select('id,full_name'),
  ]);
  const name = (id: string | null) => users?.find((u) => u.id === id)?.full_name ?? '';
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const admin = profile.role === 'admin';
  const shifts = (rows ?? []) as Shift[];
  const upcoming = shifts.filter((s) => s.shift_date >= today && s.status !== 'cancelled');
  const old = shifts.filter((s) => s.shift_date < today || s.status === 'cancelled').reverse();

  const table = (list: Shift[], past: boolean) => (
    <div className="tablewrap"><table className="cards">
      <thead><tr><th>Shift</th><th>When</th><th>Filled</th><th>Standby</th><th>Sent by</th><th>Status</th>{admin && <th></th>}</tr></thead>
      <tbody>
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
        {!list.length && <tr><td colSpan={7} className="note">{past ? 'Nothing in the last 60 days.' : 'No upcoming shifts. Create one above.'}</td></tr>}
      </tbody>
    </table></div>
  );

  return (
    <>
      <ShiftForm />
      <section className="panel">
        <h2>Upcoming shifts</h2>
        <p className="lede">Open one to see the live board.</p>
        {table(upcoming, false)}
      </section>
      <section className="panel">
        <details>
          <summary>Past and cancelled shifts ({old.length})</summary>
          <p className="lede" style={{ marginTop: 10 }}>The last 60 days.{admin ? ' Admins can delete cancelled shifts and shifts nobody was booked on, such as tests. Shifts people worked are kept as a record.' : ''}</p>
          {table(old, true)}
        </details>
      </section>
    </>
  );
}
