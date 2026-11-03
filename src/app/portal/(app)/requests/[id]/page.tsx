import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireClient } from '@/lib/portalAuth';
import { loadRequests } from '@/lib/portalData';
import { RequestCard } from '../../../ui/RequestCard';
import { EditRequest } from './EditRequest';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f-]{36}$/i;

export default async function RequestPage({ params, searchParams }: { params: { id: string }; searchParams: { sent?: string } }) {
  if (!UUID.test(params.id)) notFound();
  const { supabase, db, client, sites } = await requireClient();
  const [r] = await loadRequests(supabase, db, client.id, sites.map((s) => s.id), { from: '2000-01-01', ids: [params.id] });
  if (!r) notFound();
  const canChange = r.status !== 'cancelled' && !r.started;
  const canCancel = canChange && r.hoursToStart >= client.cutoff_hours;

  return (
    <section className="panel">
      <p className="note" style={{ margin: '0 0 6px' }}><Link href="/portal">← Your shifts</Link></p>
      {searchParams.sent && <p className="okmsg" style={{ marginBottom: 12 }}>Request sent. Our team has been told and you’ll see names here as people are confirmed.</p>}
      <RequestCard r={r} people />
      {r.notes && <p className="note" style={{ whiteSpace: 'pre-wrap' }}><b>Notes:</b> {r.notes}</p>}
      {r.status === 'cancelled' && <p className="note">{r.cancelledByClient ? 'You cancelled this request' : 'Cancelled by Staff Selection'}{r.cancelReason ? `: ${r.cancelReason}` : '.'}</p>}
      {canChange && (
        <EditRequest id={r.id} hasShift={r.hasShift} booked={r.filled} canCancel={canCancel} cutoff={client.cutoff_hours}
          initial={{ date: r.date, start: r.start, end: r.end, role: r.role, headcount: r.headcount, notes: r.notes ?? '' }} />
      )}
    </section>
  );
}
