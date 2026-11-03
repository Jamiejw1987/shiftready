import Link from 'next/link';
import { requireClient } from '@/lib/portalAuth';
import { loadRequests } from '@/lib/portalData';
import { today } from '@/lib/clients';
import { RequestCard } from '../ui/RequestCard';

export const dynamic = 'force-dynamic';

const back = (n: number) => new Date(Date.now() - n * 864e5).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });

export default async function PortalHome() {
  const { supabase, db, client, sites } = await requireClient();
  const all = await loadRequests(supabase, db, client.id, sites.map((s) => s.id), { from: back(14) });
  const t = today();
  const toMark = all.filter((r) => r.started && r.status !== 'cancelled' && r.people.some((p) => !p.noShowByOffice && (p.attended == null || (p.attended && p.stars == null))));
  const upcoming = all.filter((r) => !r.started && r.date >= t);
  const past = all.filter((r) => r.started && !toMark.includes(r)).reverse();

  return (
    <>
      <section className="panel">
        <div className="phead">
          <div>
            <h1>Your shifts</h1>
            <p className="lede" style={{ margin: 0 }}>{client.name}{sites.length === 1 ? ` · ${sites[0].name}` : ''}</p>
          </div>
          <Link className="btn blue" href="/portal/new">Request a shift</Link>
        </div>
        {!sites.length && <p className="alert" style={{ marginTop: 12 }}>You’re not set up for any sites yet. Please ask Staff Selection.</p>}
      </section>

      {toMark.length > 0 && (
        <section className="panel">
          <h2>Who turned up?</h2>
          <p className="lede">Mark attendance and rate each person. It takes a few seconds and helps us send you the best people.</p>
          <div className="pgrid">{toMark.map((r) => <RequestCard key={r.id} r={r} people href={`/portal/requests/${r.id}`} />)}</div>
        </section>
      )}

      <section className="panel">
        <h2>Coming up</h2>
        {upcoming.length ? (
          <div className="pgrid">{upcoming.map((r) => <RequestCard key={r.id} r={r} href={`/portal/requests/${r.id}`} />)}</div>
        ) : (
          <p className="note">Nothing booked yet. <Link href="/portal/new">Request a shift</Link> and our team will get on it.</p>
        )}
      </section>

      {past.length > 0 && (
        <section className="panel">
          <details>
            <summary>Last 14 days ({past.length})</summary>
            <div className="pgrid" style={{ marginTop: 12 }}>{past.map((r) => <RequestCard key={r.id} r={r} href={`/portal/requests/${r.id}`} />)}</div>
          </details>
        </section>
      )}
    </>
  );
}
