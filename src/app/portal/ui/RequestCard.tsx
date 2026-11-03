import Link from 'next/link';
import { fmtDate } from '@/lib/format';
import { stage, type PortalRequest } from '@/lib/portalData';
import { PeopleList } from './PeopleList';

/** One requested shift: when, where, how full. Optionally with the people booked on it. */
export function RequestCard({ r, href, people = false, readOnly = false }: { r: PortalRequest; href?: string; people?: boolean; readOnly?: boolean }) {
  const st = stage(r);
  const pct = Math.min(100, Math.round((r.filled / r.headcount) * 100));
  const head = (
    <>
      <div className="pc-top">
        <div>
          <div className="pc-when">{fmtDate(r.date)} · {r.start}-{r.end}</div>
          <div className="note">{r.siteName} · {r.role}{r.postedBy ? ` · posted by ${r.postedBy}` : ''}</div>
        </div>
        <span className={`pill ${st.tone}`}>{st.label}</span>
      </div>
      {r.status !== 'cancelled' && (
        <div className="pc-fill" aria-label={`${r.filled} of ${r.headcount} filled`}>
          <div className="pc-bar"><span style={{ width: `${pct}%` }} /></div>
          <span className="pc-count">{r.filled}/{r.headcount}</span>
        </div>
      )}
      {r.urgent && r.status !== 'cancelled' && !r.started && <span className="pill warn" style={{ alignSelf: 'flex-start' }}>Short notice</span>}
    </>
  );
  return (
    <div className="pcard">
      {href ? <Link href={href} className="pc-link">{head}</Link> : head}
      {people && <PeopleList requestId={r.id} people={r.people} started={r.started} readOnly={readOnly} cancelled={r.status === 'cancelled'} />}
    </div>
  );
}
