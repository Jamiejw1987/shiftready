'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Person } from '@/lib/portalData';
import { markAttendance, rateTemp } from '../actions';

/**
 * Who's booked: name and whether they need an induction. Once the shift has started, the client marks each
 * person attended or no-show and gives a quick star rating. 1 or 2 stars asks whether they want them back.
 */
export function PeopleList({ requestId, people, started, readOnly, cancelled }: { requestId: string; people: Person[]; started: boolean; readOnly: boolean; cancelled: boolean }) {
  if (cancelled) return null;
  if (!people.length) return <p className="note" style={{ margin: '8px 0 0' }}>Nobody confirmed yet. Names appear here as soon as our team books people on.</p>;
  return (
    <div className="people">
      {started && !readOnly && <p className="note" style={{ margin: 0 }}>Mark each person attended or no-show, then tap the stars to rate them.</p>}
      {people.map((p) => <PersonRow key={p.offerId} requestId={requestId} p={p} started={started} readOnly={readOnly} />)}
    </div>
  );
}

function PersonRow({ requestId, p, started, readOnly }: { requestId: string; p: Person; started: boolean; readOnly: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [stars, setStars] = useState<number | null>(null);   // a low rating waiting for the "return to site" answer
  const [back, setBack] = useState<boolean | null>(null);
  const [comment, setComment] = useState(p.comment ?? '');
  const [showComment, setShowComment] = useState(false);
  const [err, setErr] = useState('');
  const attended = p.noShowByOffice ? false : p.attended;

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => start(async () => {
    setErr('');
    const r = await fn();
    if (!r.ok) setErr(r.error ?? 'Something went wrong.'); else { after?.(); router.refresh(); }
  });
  const rate = (n: number) => {
    if (readOnly) return;
    if (n <= 2) { setStars(n); setBack(null); return; }
    setStars(null);
    run(() => rateTemp(requestId, p.offerId, n, null, comment));
  };

  return (
    <div className="person">
      <div className="person-top">
        <div>
          <b>{p.first} {p.last}</b>
          <div>{p.beenBefore ? <span className="pill ok">Been to site before</span> : <span className="pill warn">Needs induction</span>}</div>
        </div>
        {started && (
          <div className="seg" role="group" aria-label={`Attendance for ${p.first}`}>
            <button type="button" className={attended === true ? 'on ok' : ''} disabled={pending || readOnly || p.noShowByOffice} onClick={() => run(() => markAttendance(requestId, p.offerId, true))}>Attended</button>
            <button type="button" className={attended === false ? 'on bad' : ''} disabled={pending || readOnly || p.noShowByOffice} onClick={() => run(() => markAttendance(requestId, p.offerId, false))}>No-show</button>
          </div>
        )}
      </div>
      {started && attended === true && (
        <div className="rate">
          <div className="stars" role="group" aria-label={`Rate ${p.first}`}>
            {[1, 2, 3, 4, 5].map((n) => {
              const lit = (stars ?? p.stars ?? 0) >= n;
              return <button type="button" key={n} className={lit ? 'star lit' : 'star'} aria-label={`${n} star${n === 1 ? '' : 's'}`} aria-pressed={(stars ?? p.stars) === n} disabled={pending || readOnly} onClick={() => rate(n)}>★</button>;
            })}
          </div>
          {p.stars && stars == null && <span className="note">{p.returnToSite === false ? 'You asked for them not to return' : 'Rated'}{p.comment ? ` · “${p.comment}”` : ''}</span>}
          {!readOnly && p.stars && stars == null && !showComment && <button type="button" className="linkbtn" onClick={() => setShowComment(true)}>{p.comment ? 'Edit comment' : 'Add a comment'}</button>}
        </div>
      )}
      {stars != null && (
        <div className="lowq">
          <b>Do you want {p.first} to return to site?</b>
          <div className="seg">
            <button type="button" className={back === true ? 'on ok' : ''} onClick={() => setBack(true)}>Yes</button>
            <button type="button" className={back === false ? 'on bad' : ''} onClick={() => setBack(false)}>No</button>
          </div>
          <div className="f"><label className="l" htmlFor={`c-${p.offerId}`}>What happened? (optional, only our team sees this)</label>
            <textarea id={`c-${p.offerId}`} value={comment} maxLength={500} onChange={(e) => setComment(e.target.value)} /></div>
          {back === false && <p className="note" style={{ margin: 0 }}>We won’t send {p.first} to your sites again.</p>}
          <div className="btnrow">
            <button type="button" className="btn ghost small" onClick={() => setStars(null)}>Cancel</button>
            <button type="button" className="btn blue small" disabled={pending || back == null} onClick={() => run(() => rateTemp(requestId, p.offerId, stars, back, comment), () => setStars(null))}>Save rating</button>
          </div>
        </div>
      )}
      {showComment && stars == null && (
        <div className="lowq">
          <div className="f"><label className="l" htmlFor={`cc-${p.offerId}`}>Comment (only our team sees this)</label>
            <textarea id={`cc-${p.offerId}`} value={comment} maxLength={500} onChange={(e) => setComment(e.target.value)} /></div>
          <div className="btnrow">
            <button type="button" className="btn ghost small" onClick={() => setShowComment(false)}>Cancel</button>
            <button type="button" className="btn blue small" disabled={pending} onClick={() => run(() => rateTemp(requestId, p.offerId, p.stars!, p.returnToSite, comment), () => setShowComment(false))}>Save</button>
          </div>
        </div>
      )}
      {p.noShowByOffice && <span className="note">Recorded as a no-show by Staff Selection.</span>}
      {err && <p className="err" style={{ margin: 0 }}>{err}</p>}
    </div>
  );
}
