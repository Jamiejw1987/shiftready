import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { displayMobile } from '@/lib/phone';
import { JobActions, Candidates, AddCandidate, EditJob } from './JobDetail';

export const dynamic = 'force-dynamic';
const day = (d: string | null) => (d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '-');

export default async function JobPage({ params }: { params: { id: string } }) {
  const { supabase, profile } = await requireStaff();
  const admin = profile.role === 'admin';
  const { data: j } = await supabase.from('jobs').select('*').eq('id', params.id).maybeSingle();
  if (!j) notFound();
  const [{ data: cands }, { data: clients }, { data: creator }] = await Promise.all([
    supabase.from('job_candidates').select('id,status,added_at,temp_id,temps(first_name,last_name,mobile,postcode)').eq('job_id', j.id).order('added_at'),
    supabase.from('clients').select('id,name').eq('active', true).order('name'),
    j.created_by ? supabase.from('profiles').select('full_name').eq('id', j.created_by).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const list = (cands ?? []).map((c) => {
    const t = c.temps as unknown as { first_name: string; last_name: string; mobile: string; postcode: string | null };
    return { id: c.id, tempId: c.temp_id, status: c.status as 'proposed' | 'confirmed' | 'started' | 'dropped', name: `${t.first_name} ${t.last_name}`, mobile: displayMobile(t.mobile), postcode: t.postcode };
  });
  const placed = list.filter((c) => c.status === 'confirmed' || c.status === 'started').length;
  const pill = j.status === 'filled' ? ['ok', 'Filled'] : j.status === 'closed' ? ['mute', 'Closed'] : placed >= j.heads ? ['blue', 'Ready to mark filled'] : ['warn', `${j.heads - placed} to fill`];

  return (
    <>
      <section className="panel">
        <p className="note" style={{ margin: '0 0 6px' }}><Link href="/jobs">← Jobs</Link></p>
        <h1>{j.heads} × {j.role}</h1>
        <div className="btnrow" style={{ marginBottom: 12 }}><b style={{ fontSize: 18 }}>{j.client_name}</b><span className={`pill ${pill[0]}`}>{pill[1]}</span><span className="pill mute">{placed} of {j.heads} placed</span></div>
        <dl className="kv" style={{ marginBottom: 14 }}>
          <dt>Pay rate</dt><dd>{j.pay_rate != null ? `£${Number(j.pay_rate).toFixed(2)}/hr` : '-'}</dd>
          {admin && <><dt>Charge rate</dt><dd>{j.charge_rate != null ? `£${Number(j.charge_rate).toFixed(2)}/hr` : '-'}</dd></>}
          <dt>Shifts</dt><dd>{j.shift_pattern || '-'}</dd>
          <dt>Start date</dt><dd>{day(j.start_date)}</dd>
          <dt>Site</dt><dd>{j.location || '-'}</dd>
          <dt>Requirements</dt><dd>{j.requirements || '-'}</dd>
          {j.notes && <><dt>Notes</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{j.notes}</dd></>}
          <dt>Added</dt><dd>{new Date(j.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}{creator?.full_name ? ` by ${creator.full_name}` : ''}</dd>
        </dl>
        <JobActions id={j.id} status={j.status} placed={placed} heads={j.heads} admin={admin} />
        <EditJob clients={(clients ?? []).map((c) => ({ id: c.id, name: c.name }))} admin={admin} job={{
          id: j.id, clientId: j.client_id ?? '', clientName: j.client_name, role: j.role, heads: String(j.heads),
          payRate: j.pay_rate != null ? String(j.pay_rate) : '', chargeRate: j.charge_rate != null ? String(j.charge_rate) : '',
          shiftPattern: j.shift_pattern ?? '', startDate: j.start_date ?? '', location: j.location ?? '', requirements: j.requirements ?? '', notes: j.notes ?? '',
        }} />
      </section>

      <section className="panel">
        <h2>Candidates</h2>
        <p className="lede"><b>Put forward</b>: suggested, not agreed yet. <b>Confirmed</b>: they’ve said yes. <b>Started</b>: they’re working there. Confirmed and started count towards filling the job.</p>
        <Candidates list={list} />
        <AddCandidate jobId={j.id} />
      </section>
    </>
  );
}
