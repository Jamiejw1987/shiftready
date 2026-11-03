import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { fmtDate, fmtDateTime, hhmm } from '@/lib/format';
import { displayMobile } from '@/lib/phone';
import { hasStarted } from '@/lib/clients';
import { ShiftForm } from '../../shifts/ShiftForm';
import { RequestActions } from './RequestActions';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f-]{36}$/i;

export default async function ClientRequest({ params }: { params: { id: string } }) {
  if (!UUID.test(params.id)) notFound();
  const { supabase } = await requireStaff();
  const { data: r } = await supabase.from('client_requests')
    .select('*,clients(id,name,is_test,cutoff_hours),client_sites(name,address,postcode),client_users!client_requests_created_by_fkey(full_name,email,mobile,job_title)')
    .eq('id', params.id).maybeSingle();
  if (!r) notFound();
  const c = r.clients as unknown as { id: string; name: string; is_test: boolean; cutoff_hours: number };
  const site = r.client_sites as unknown as { name: string; address: string; postcode: string } | null;
  const who = r.client_users as unknown as { full_name: string | null; email: string; mobile: string | null; job_title: string | null } | null;
  const [{ data: shifts }, { data: staff }, { data: log }] = await Promise.all([
    supabase.from('shifts').select('id,status,heads,offers(status)').eq('request_id', r.id),
    supabase.from('profiles').select('id,full_name'),
    createAdminClient().from('audit_log').select('id,detail,created_at').eq('entity_id', r.id).order('created_at', { ascending: false }).limit(50),
  ]);
  const shift = (shifts ?? []).find((s) => s.status !== 'cancelled');
  const filled = ((shift?.offers ?? []) as { status: string }[]).filter((o) => o.status === 'accepted').length;
  const interested = ((shift?.offers ?? []) as { status: string }[]).filter((o) => o.status === 'interested').length;
  const started = hasStarted(r);
  const picker = staff?.find((s) => s.id === r.acknowledged_by)?.full_name;

  return (
    <>
      <section className="panel">
        <p className="note" style={{ margin: '0 0 6px' }}><Link href="/client-requests">← Client requests</Link></p>
        <h1>{c.name}{c.is_test && <> <span className="pill blue">Test</span></>}</h1>
        <p className="lede" style={{ marginBottom: 8 }}>{fmtDate(r.request_date)} · {hhmm(r.start_time)}-{hhmm(r.end_time)} · {r.headcount} × {r.role} · {site?.name} ({site?.address}, {site?.postcode})</p>
        <div className="btnrow" style={{ marginBottom: 12 }}>
          {r.is_urgent && r.status !== 'cancelled' && <span className="pill warn">Urgent: under {c.cutoff_hours} hrs’ notice</span>}
          <span className={`pill ${r.status === 'cancelled' ? 'bad' : r.status === 'submitted' ? 'warn' : 'blue'}`}>{r.status === 'cancelled' ? (r.cancelled_by_client ? 'Cancelled by the client' : 'Cancelled') : r.status === 'submitted' ? 'New' : `Picked up${picker ? ` by ${picker}` : ''}`}</span>
          {shift && <span className={`pill ${filled >= r.headcount ? 'ok' : 'warn'}`}>{filled}/{r.headcount} confirmed{interested ? ` · ${interested} interested` : ''}</span>}
        </div>
        <dl className="kv">
          <dt>Posted by</dt><dd>{who ? <>{who.full_name || who.email}{who.job_title ? `, ${who.job_title}` : ''}<br /><a href={`mailto:${who.email}`}>{who.email}</a>{who.mobile && <> · <a href={`tel:${who.mobile}`}>{displayMobile(who.mobile)}</a></>}</> : '-'}<div className="note">{fmtDateTime(r.created_at)}</div></dd>
          <dt>Notes</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{r.notes || '-'}</dd>
          {r.status === 'cancelled' && <><dt>Cancelled</dt><dd>{r.cancelled_at ? fmtDateTime(r.cancelled_at) : ''}{r.cancel_reason ? ` · ${r.cancel_reason}` : ''}</dd></>}
        </dl>
        {r.status === 'cancelled' && r.cancelled_by_client && shift && (
          <p className="alert bad" style={{ marginTop: 12 }}>The client cancelled this, but the shift is still live. <Link href={`/shifts/${shift.id}`}>Open the shift</Link> and cancel it so booked temps get a text.</p>
        )}
        <div className="bar">
          <span className="note"><Link href={`/clients/${c.id}`}>{c.name} client page</Link></span>
          <span className="btnrow">
            {shift && <Link className="btn blue" href={`/shifts/${shift.id}`}>Open the shift board</Link>}
            {r.status !== 'cancelled' && !started && <RequestActions id={r.id} canAck={r.status === 'submitted'} canCancel={!shift} />}
          </span>
        </div>
      </section>

      {!shift && r.status !== 'cancelled' && !started && (
        <ShiftForm requestId={r.id} prefill={{
          client: c.name, site: site?.address ?? '', sitePostcode: site?.postcode ?? '', date: r.request_date,
          start: hhmm(r.start_time), end: hhmm(r.end_time), jobType: r.role, duties: r.notes ?? '', heads: String(r.headcount),
        }} />
      )}

      <section className="panel">
        <h2>History</h2>
        <div className="tablewrap"><table>
          <tbody>
            {(log ?? []).map((a) => <tr key={a.id}><td className="mono" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(a.created_at)}</td><td>{a.detail}</td></tr>)}
            {!log?.length && <tr><td className="note">Nothing yet.</td></tr>}
          </tbody>
        </table></div>
      </section>
    </>
  );
}
