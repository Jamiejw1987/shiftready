import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { AutoRefresh } from '../shifts/[id]/BoardActions';

export const dynamic = 'force-dynamic';

type Row = {
  id: string; client_id: string; site_id: string; request_date: string; start_time: string; end_time: string; role: string; headcount: number;
  status: string; is_urgent: boolean; created_at: string; cancelled_by_client: boolean | null; acknowledged_by: string | null;
  clients: { name: string; is_test: boolean } | null; client_sites: { name: string } | null; client_users: { full_name: string | null; email: string } | null;
};

export default async function ClientRequests() {
  const { supabase } = await requireStaff();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const back = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  const { data } = await supabase.from('client_requests')
    .select('id,client_id,site_id,request_date,start_time,end_time,role,headcount,status,is_urgent,created_at,cancelled_by_client,acknowledged_by,clients(name,is_test),client_sites(name),client_users!client_requests_created_by_fkey(full_name,email)')
    .gte('request_date', back).order('request_date').order('start_time');
  const rows = (data ?? []) as unknown as Row[];
  const ids = rows.map((r) => r.id);
  const [{ data: shifts }, { data: staff }] = await Promise.all([
    ids.length ? supabase.from('shifts').select('id,request_id,status,offers(status)').in('request_id', ids) : Promise.resolve({ data: [] as { id: string; request_id: string; status: string; offers: { status: string }[] | null }[] }),
    supabase.from('profiles').select('id,full_name'),
  ]);
  const shiftOf = (id: string) => (shifts ?? []).find((s) => s.request_id === id && s.status !== 'cancelled');
  const filled = (id: string) => (shiftOf(id)?.offers ?? []).filter((o) => o.status === 'accepted').length;
  const interested = (id: string) => (shiftOf(id)?.offers ?? []).filter((o) => o.status === 'interested').length;
  const upcoming = rows.filter((r) => r.request_date >= today);
  const fresh = upcoming.filter((r) => r.status === 'submitted').sort((a, b) => Number(b.is_urgent) - Number(a.is_urgent) || a.request_date.localeCompare(b.request_date));
  const going = upcoming.filter((r) => r.status === 'acknowledged');
  const clientCancelled = upcoming.filter((r) => r.status === 'cancelled' && r.cancelled_by_client && shiftOf(r.id));
  const past = rows.filter((r) => r.request_date < today).reverse();
  const who = (r: Row) => r.client_users ? r.client_users.full_name || r.client_users.email : '';

  const table = (list: Row[], empty: string, showPicked = false) => (
    <div className="tablewrap"><table className="cards">
      <thead><tr><th>Client</th><th>When</th><th>Need</th><th>Posted</th><th>Filled</th><th>Status</th></tr></thead>
      <tbody>
        {list.map((r) => {
          const sh = shiftOf(r.id);
          const f = filled(r.id), i = interested(r.id);
          return (
            <tr key={r.id}>
              <td><Link href={`/client-requests/${r.id}`}><b>{r.clients?.name}</b></Link>{r.clients?.is_test && <> <span className="pill blue">Test</span></>}<div className="note">{r.client_sites?.name}</div></td>
              <td data-l="When"><b>{fmtDate(r.request_date)}</b> {r.start_time.slice(0, 5)}-{r.end_time.slice(0, 5)}</td>
              <td data-l="Need">{r.headcount} × {r.role}</td>
              <td data-l="Posted">{who(r)}<div className="note">{fmtDateTime(r.created_at)}</div></td>
              <td className="num" data-l="Filled">{sh ? `${f}/${r.headcount}` : '-'}{i > 0 && <div className="note">{i} interested</div>}</td>
              <td>
                {r.is_urgent && r.status !== 'cancelled' && <span className="pill warn">Urgent</span>}{' '}
                <span className={`pill ${r.status === 'cancelled' ? 'bad' : r.status === 'submitted' ? 'warn' : f >= r.headcount ? 'ok' : 'blue'}`}>
                  {r.status === 'cancelled' ? (r.cancelled_by_client ? 'Client cancelled' : 'Cancelled') : r.status === 'submitted' ? 'New' : !sh ? 'Picked up' : f >= r.headcount ? 'Filled' : 'Filling'}
                </span>
                {showPicked && r.acknowledged_by && <div className="note">{staff?.find((s) => s.id === r.acknowledged_by)?.full_name}</div>}
              </td>
            </tr>
          );
        })}
        {!list.length && <tr><td colSpan={6} className="note">{empty}</td></tr>}
      </tbody>
    </table></div>
  );

  return (
    <>
      <AutoRefresh seconds={30} />
      <section className="panel">
        <h1>Client requests</h1>
        <p className="lede">Shifts clients have asked for in their portal, kept apart from shifts you create yourselves. Open one to pick it up and create the shift.</p>
        {clientCancelled.length > 0 && (
          <p className="alert bad" style={{ marginBottom: 12 }}>
            {clientCancelled.length} client-cancelled request{clientCancelled.length === 1 ? ' still has' : 's still have'} a live shift: {clientCancelled.map((r, i) => <span key={r.id}>{i ? ', ' : ''}<Link href={`/shifts/${shiftOf(r.id)!.id}`}>{r.clients?.name} {fmtDate(r.request_date)}</Link></span>)}. Cancel the shift so booked temps get a text.
          </p>
        )}
        <h2>New <span className="count">{fresh.length}</span></h2>
        {table(fresh, 'Nothing new. You’ll get a text and an email when a client posts.')}
      </section>
      <section className="panel">
        <h2>Being filled <span className="count">{going.length}</span></h2>
        {table(going, 'Nothing in progress.', true)}
      </section>
      <section className="panel">
        <details>
          <summary>Past 14 days and cancelled ({past.length + upcoming.filter((r) => r.status === 'cancelled').length})</summary>
          <div style={{ marginTop: 12 }}>{table([...upcoming.filter((r) => r.status === 'cancelled'), ...past], 'Nothing here.', true)}</div>
        </details>
      </section>
    </>
  );
}
