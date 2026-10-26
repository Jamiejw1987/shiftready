import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { shiftWhen } from '@/lib/format';
import { ShiftForm } from './ShiftForm';

export const dynamic = 'force-dynamic';

export default async function ShiftsPage() {
  const { supabase } = await requireStaff();
  const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const [{ data: shifts }, { data: users }] = await Promise.all([
    supabase.from('shifts').select('*, offers(status)').gte('shift_date', since).order('shift_date').order('start_time'),
    supabase.from('profiles').select('id,full_name'),
  ]);
  const name = (id: string | null) => users?.find((u) => u.id === id)?.full_name ?? '';
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <ShiftForm />
      <section className="panel">
        <h2>Shifts</h2>
        <p className="lede">Upcoming shifts and the last 7 days. Open one to see the live board.</p>
        <div className="tablewrap"><table className="cards">
          <thead><tr><th>Shift</th><th>When</th><th>Filled</th><th>Standby</th><th>Sent by</th><th>Status</th></tr></thead>
          <tbody>
            {(shifts ?? []).map((s) => {
              const offers = (s.offers ?? []) as { status: string }[];
              const filled = offers.filter((o) => o.status === 'accepted').length;
              const standby = offers.filter((o) => o.status === 'standby').length;
              const past = s.shift_date < today;
              const pill = s.status === 'cancelled' ? ['bad', 'Cancelled'] : filled >= s.heads ? ['ok', 'Filled'] : past ? ['mute', 'Past'] : ['warn', `${s.heads - filled} to fill`];
              return (
                <tr key={s.id} style={past ? { opacity: 0.6 } : undefined}>
                  <td><Link href={`/shifts/${s.id}`}><b>{s.client}</b></Link><div className="note">{s.job_type} · {s.site_postcode}</div></td>
                  <td data-l="When">{shiftWhen(s)}</td>
                  <td className="num" data-l="Filled">{filled}/{s.heads}</td>
                  <td className="num" data-l="Standby">{standby}</td>
                  <td data-l="Sent by">{name(s.sent_by)}</td>
                  <td><span className={`pill ${pill[0]}`}>{pill[1]}</span></td>
                </tr>
              );
            })}
            {!shifts?.length && <tr><td colSpan={6} className="note">No shifts yet. Create one above.</td></tr>}
          </tbody>
        </table></div>
      </section>
    </>
  );
}
