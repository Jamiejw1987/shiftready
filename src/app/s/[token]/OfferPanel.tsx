'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { respond } from './actions';

type Props = {
  token: string; firstName: string; tempActive: boolean; offerStatus: string; standbyPos: number;
  shiftState: 'open' | 'full' | 'cancelled' | 'past'; placesLeft: number;
  shift: { client: string; site: string; when: string; whenShort: string; hours: number; pay: number; role: string; duties: string[]; ppe: string[]; miles: number | null };
};

function State({ badge, kind, title, text, children }: { badge: string; kind: string; title: string; text: string; children?: React.ReactNode }) {
  return (
    <div className="state">
      <div className={`badge ${kind}`}>{badge}</div>
      <div className="big">{title}</div>
      <p>{text}</p>
      {children}
    </div>
  );
}

export function OfferPanel(p: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ticked, setTicked] = useState<boolean[]>(p.shift.ppe.map(() => false));
  const [declining, setDeclining] = useState(false);
  const [err, setErr] = useState('');
  const s = p.shift;

  function act(action: Parameters<typeof respond>[1], reason?: string) {
    setErr('');
    if (action === 'accept' && ticked.some((t) => !t)) return setErr('Tick each item above to confirm, then accept.');
    start(async () => {
      const r = await respond(p.token, action, { ppeTicked: ticked.filter(Boolean).length, reason });
      if (r.result === 'error') setErr('Something went wrong. Please try again, or call the office.');
      if (r.result === 'not_active') setErr('Your profile is on hold. Please call the office.');
      setDeclining(false);
      router.refresh();
    });
  }

  if (p.shiftState === 'cancelled') return <State badge="✕" kind="mute" title="Shift cancelled" text={`Sorry, the ${s.client} shift on ${s.whenShort} was cancelled. You don't need to attend.`} />;
  if (p.offerStatus === 'noshow') return <State badge="!" kind="mute" title="Marked as no-show" text="Your consultant recorded you as not attending this shift. Call the office if this is wrong." />;
  if (p.offerStatus === 'accepted')
    return <State badge="✓" kind="ok" title="Shift confirmed" text={`${s.client}, ${s.when}. Arrive 10 minutes early at ${s.site}. We'll text you a reminder the day before.`} />;
  if (p.shiftState === 'past') return <State badge="–" kind="mute" title="This shift has passed" text="Keep an eye on your texts for new shifts." />;
  if (!p.tempActive) return <State badge="!" kind="mute" title="Can’t accept right now" text="Your profile isn’t active for shift offers. Please call the office." />;
  if (p.offerStatus === 'declined')
    return <State badge="–" kind="mute" title="Shift declined" text="Thanks for letting us know. We'll keep sending shifts that suit you.">
      {p.shiftState === 'open' && <button className="btn ghost" disabled={pending} onClick={() => act('reset')}>Change my answer</button>}</State>;
  if (p.offerStatus === 'standby')
    return <State badge={`#${p.standbyPos}`} kind="blue" title="You’re on standby" text="If someone drops out you're offered the place in this order. We'll text you straight away.">
      <button className="btn ghost" disabled={pending} onClick={() => act('reset')}>Leave standby</button></State>;
  if (p.offerStatus === 'alerts')
    return <State badge="✓" kind="ok" title="Alerts on" text={`We'll text you when similar ${s.role.toLowerCase()} shifts come up near you.`} />;
  if (p.shiftState === 'full')
    return <State badge="✕" kind="mute" title="Shift covered" text="Sorry, all places on this shift have been filled.">
      <div className="stack">
        <button className="btn blue" disabled={pending} onClick={() => act('standby')}>Put me on standby</button>
        <button className="btn ghost" disabled={pending} onClick={() => act('alerts')}>Notify me of similar shifts</button>
      </div></State>;

  return (
    <div className="card">
      <div className="top">
        <div className="pay">£{s.pay.toFixed(2)}<small> /hr</small></div>
        <span className={`pill ${p.placesLeft <= 1 ? 'warn' : 'ok'}`}>{p.placesLeft} place{p.placesLeft === 1 ? '' : 's'} left</span>
      </div>
      <div className="in">
        <p style={{ margin: 0 }}>Hi {p.firstName}, here’s a shift for you.</p>
        <div className="note">{s.hours.toFixed(1)} hrs · about £{(s.hours * s.pay).toFixed(2)} before tax</div>
        <dl className="meta">
          <dt>Role</dt><dd>{s.role}</dd>
          <dt>Client</dt><dd>{s.client}</dd>
          <dt>When</dt><dd>{s.when}</dd>
          <dt>Where</dt><dd>{s.site}{s.miles != null ? ` · ${s.miles} mi` : ''}</dd>
        </dl>
        {s.duties.length > 0 && <div><h3>Duties</h3><ul className="duties">{s.duties.map((d) => <li key={d}>{d}</li>)}</ul></div>}
        {declining ? (
          <>
            <div><h3>Reason (optional)</h3>
              <div className="reasons">{['Not available', 'Too far', 'Pay rate', 'Other'].map((r) => (
                <button key={r} className="btn ghost small" disabled={pending} onClick={() => act('decline', r)}>{r}</button>))}</div></div>
            <div className="actions"><button className="btn ghost" onClick={() => setDeclining(false)}>Back</button>
              <button className="btn" disabled={pending} onClick={() => act('decline')}>Decline without reason</button></div>
          </>
        ) : (
          <>
            {s.ppe.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <h3>Confirm before accepting</h3>
                {s.ppe.map((item, i) => (
                  <label key={item} className="tick">
                    <input type="checkbox" checked={ticked[i]} onChange={(e) => setTicked(ticked.map((v, j) => (j === i ? e.target.checked : v)))} />
                    I have {item.toLowerCase()}
                  </label>
                ))}
              </div>
            )}
            {err && <p className="err">{err}</p>}
            <div className="actions">
              <button className="btn ghost" disabled={pending} onClick={() => setDeclining(true)}>Decline</button>
              <button className="btn blue" disabled={pending} onClick={() => act('accept')}>{pending ? 'Accepting…' : 'Accept shift'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
