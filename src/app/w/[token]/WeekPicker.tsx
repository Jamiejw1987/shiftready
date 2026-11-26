'use client';
import { useState, useTransition } from 'react';
import { saveWeek } from './actions';

type Site = { poolId: string; name: string; days: number[] };
const label = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });

export function WeekPicker(p: { token: string; first: string; week: string; dates: string[]; sites: Site[]; closed: boolean; active: boolean; onHold: boolean; replied: boolean }) {
  const [pending, start] = useTransition();
  const [pick, setPick] = useState<Record<string, Set<number>>>(Object.fromEntries(p.sites.map((s) => [s.poolId, new Set(s.days)])));
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');

  const state = (title: string, text: string) => <div className="state"><div className="badge mute">!</div><div className="big">{title}</div><p>{text}</p></div>;
  if (p.onHold) return state('You’re on hold', 'You can’t take shifts at the moment. Please contact the office.');
  if (!p.active) return state('Can’t reply right now', 'Your profile isn’t active for shifts. Please call the office.');
  if (!p.sites.length) return state('Nothing to fill in', 'Please call the office if you’d like shifts next week.');

  const toggle = (pool: string, d: number) => { setDone(''); setPick((x) => { const s = new Set(x[pool]); s.has(d) ? s.delete(d) : s.add(d); return { ...x, [pool]: s }; }); };
  const save = () => start(async () => {
    setErr('');
    const r = await saveWeek(p.token, p.sites.map((s) => ({ poolId: s.poolId, days: [...pick[s.poolId]] })));
    if (!r.ok) return setErr(r.error ?? 'Something went wrong. Please try again.');
    setDone(r.days ? `Thanks ${p.first}. We’ve got the ${r.days} day${r.days === 1 ? '' : 's'} you want. We’ll be in touch to book you.` : `Thanks ${p.first}. We’ve noted you don’t want shifts next week.`);
  });

  return (
    <div className="card">
      <div className="top"><b style={{ fontSize: 18 }}>Next week</b><span className="pill ok">{p.week}</span></div>
      <div className="in">
        <p style={{ margin: 0 }}>Hi {p.first}, which days do you want shifts next week? Tick every day you can do. {p.closed ? '' : 'You can change this until Sunday night.'}</p>
        {p.closed && <p className="alert" style={{ margin: 0 }}>This week has closed. Please call the office if you can do extra days.</p>}
        {p.sites.map((s) => (
          <div key={s.poolId} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {p.sites.length > 1 && <h3 style={{ margin: '6px 0 0' }}>{s.name}</h3>}
            {p.dates.map((d, i) => (
              <label key={d} className="tick">
                <input type="checkbox" disabled={p.closed || pending} checked={pick[s.poolId].has(i + 1)} onChange={() => toggle(s.poolId, i + 1)} />
                {label(d)}
              </label>
            ))}
          </div>
        ))}
        {!p.closed && (
          <div className="actions">
            <button className="btn blue" disabled={pending} onClick={save}>{pending ? 'Saving…' : p.replied ? 'Update my days' : 'Send my days'}</button>
          </div>
        )}
        {err && <p className="err" style={{ margin: 0 }}>{err}</p>}
        {done && <p className="okmsg" style={{ margin: 0 }}>{done}</p>}
      </div>
    </div>
  );
}
