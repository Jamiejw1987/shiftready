'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setAvailability } from './actions';

type Day = { offerId: string; date: string; booked: boolean; available: boolean | null; closed: boolean };
type Props = {
  token: string; firstName: string; tempActive: boolean; bankUrl: string | null; days: Day[];
  shift: { client: string; site: string; when: string; time: string; hours: number; pay: number; role: string; duties: string[]; ppe: string[] };
};
const label = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });

export function SeriesPanel(p: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const answered = p.days.some((d) => d.available !== null);
  const [pick, setPick] = useState<Set<string>>(new Set(p.days.filter((d) => d.booked || d.available).map((d) => d.offerId)));
  const [ticked, setTicked] = useState<boolean[]>(p.shift.ppe.map(() => answered));
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState('');
  const s = p.shift;
  const open = p.days.filter((d) => !d.closed && !d.booked);
  const booked = p.days.filter((d) => d.booked);

  function save(all?: boolean | 'none') {
    setErr(''); setSaved('');
    const ids = all === true ? open.map((d) => d.offerId) : all === 'none' ? [] : open.filter((d) => pick.has(d.offerId)).map((d) => d.offerId);
    if (ids.length && ticked.some((t) => !t)) return setErr('Tick each item above to confirm you have it.');
    start(async () => {
      const r = await setAvailability(p.token, ids);
      if (!r.ok) return setErr(r.error ?? 'Something went wrong. Please try again.');
      setSaved(ids.length ? `Thanks ${p.firstName}. We’ve got the ${ids.length} day${ids.length === 1 ? '' : 's'} you can do. We’ll text you when you’re booked.` : 'Thanks for letting us know.');
      router.refresh();
    });
  }

  if (!p.tempActive) return <div className="state"><div className="badge mute">!</div><div className="big">Can’t reply right now</div><p>Your profile isn’t active for shift offers. Please call the office.</p></div>;

  return (
    <div className="card">
      <div className="top">
        <div className="pay">£{s.pay.toFixed(2)}<small> /hr</small></div>
        <span className="pill ok">{p.days.length} day{p.days.length === 1 ? '' : 's'}</span>
      </div>
      <div className="in">
        <p style={{ margin: 0 }}>Hi {p.firstName}, which days can you do?</p>
        <dl className="meta">
          <dt>Role</dt><dd>{s.role}</dd>
          <dt>Client</dt><dd>{s.client}</dd>
          <dt>Hours</dt><dd>{s.time} ({s.hours.toFixed(1)} hrs a day)</dd>
          <dt>Where</dt><dd>{s.site}</dd>
        </dl>
        {s.duties.length > 0 && <div><h3>Duties</h3><ul className="duties">{s.duties.map((d) => <li key={d}>{d}</li>)}</ul></div>}

        {booked.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h3>You’re booked on</h3>
            {booked.map((d) => <div key={d.offerId} className="slot" style={{ marginTop: 0 }}><span>{label(d.date)}</span><span className="pill ok">Booked</span></div>)}
            {p.bankUrl && <a className="btn blue" href={p.bankUrl}>Add bank details before your first shift</a>}
          </div>
        )}

        {open.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h3>Tick the days you can do</h3>
            {open.map((d) => (
              <label key={d.offerId} className="tick">
                <input type="checkbox" checked={pick.has(d.offerId)} onChange={() => setPick((x) => { const n = new Set(x); n.has(d.offerId) ? n.delete(d.offerId) : n.add(d.offerId); return n; })} />
                {label(d.date)}
              </label>
            ))}
            {s.ppe.length > 0 && (
              <>
                <h3 style={{ marginTop: 8 }}>Confirm you have</h3>
                {s.ppe.map((item, i) => (
                  <label key={item} className="tick"><input type="checkbox" checked={ticked[i]} onChange={(e) => setTicked(ticked.map((v, j) => (j === i ? e.target.checked : v)))} /> I have {item.toLowerCase()}</label>
                ))}
              </>
            )}
            <p className="note" style={{ margin: 0 }}>This tells us when you’re free. You’re not booked until we confirm by text.</p>
            {err && <p className="err">{err}</p>}
            {saved && <p className="okmsg">{saved}</p>}
            <div className="actions">
              <button className="btn ghost" disabled={pending} onClick={() => save('none')}>I can’t do any</button>
              <button className="btn blue" disabled={pending || !pick.size} onClick={() => save()}>{pending ? 'Sending…' : answered ? 'Update my days' : 'Send my days'}</button>
            </div>
          </div>
        )}
        {!open.length && !booked.length && <p className="note" style={{ margin: 0 }}>These shifts have now closed. Keep an eye on your texts for new ones.</p>}
      </div>
    </div>
  );
}
