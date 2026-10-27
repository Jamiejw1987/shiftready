'use client';
import { useEffect, useState, useTransition } from 'react';
import { JOB_TYPES, PPE_OPTIONS } from '@/lib/format';
import { createAndSendShift, previewReach } from './actions';

const tomorrow = () => new Date(Date.now() + 864e5).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const label = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const weekdaysFrom = (iso: string) => Array.from({ length: 7 }, (_, i) => addDays(iso, i)).filter((x) => ![0, 6].includes(new Date(x + 'T12:00:00Z').getUTCDay()));

export function ShiftForm() {
  const [pending, start] = useTransition();
  const [f, setF] = useState({
    client: '', site: '', sitePostcode: '', date: tomorrow(), start: '06:00', end: '14:00',
    jobType: 'Warehouse', duties: '', pay: '', heads: '1', radius: '15', ppe: ['Safety boots', 'Hi-vis vest'] as string[],
  });
  const [multi, setMulti] = useState(false);
  const [days, setDays] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const [reach, setReach] = useState<string>('');
  const [confirming, setConfirming] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => { setF({ ...f, [k]: e.target.value }); setConfirming(false); };

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!f.sitePostcode.trim()) return setReach('');
      const r = await previewReach(f.sitePostcode, f.jobType, parseFloat(f.radius) || 0);
      setReach(r.ok ? `Goes to ${r.count} active temp${r.count === 1 ? '' : 's'} cleared for ${f.jobType} within ${f.radius} miles` : r.error);
    }, 500);
    return () => clearTimeout(t);
  }, [f.sitePostcode, f.jobType, f.radius]);

  function send() {
    setErr('');
    if (!confirming) return setConfirming(true);
    start(async () => {
      const r = await createAndSendShift({ ...f, date: multi && days.length ? days[0] : f.date, pay: parseFloat(f.pay), heads: parseInt(f.heads), radius: parseFloat(f.radius), dates: multi ? days : undefined });
      if (r && !r.ok) { setErr(r.error); setConfirming(false); }
    });
  }

  return (
    <section className="panel">
      <h1>Create shift</h1>
      <p className="lede">Offers go by text to active temps cleared for the job type, within the radius of the site.</p>
      <div className="form">
        <div className="f w2"><label className="l" htmlFor="client">Client</label><input id="client" type="text" value={f.client} onChange={set('client')} /></div>
        <div className="f"><label className="l" htmlFor="site">Site address</label><input id="site" type="text" placeholder="Unit 4, Euroway Estate" value={f.site} onChange={set('site')} /></div>
        <div className="f"><label className="l" htmlFor="sitePostcode">Site postcode</label><input id="sitePostcode" type="text" value={f.sitePostcode} onChange={set('sitePostcode')} /></div>
        <div className="f"><label className="l" htmlFor="date">{multi ? 'First day' : 'Date'}</label><input id="date" type="date" value={f.date} onChange={(e) => { set('date')(e); if (multi) setDays(weekdaysFrom(e.target.value)); }} /></div>
        <div className="f"><label className="l" htmlFor="start">Start</label><input id="start" type="time" value={f.start} onChange={set('start')} /></div>
        <div className="f"><label className="l" htmlFor="end">Finish</label><input id="end" type="time" value={f.end} onChange={set('end')} /></div>
        <div className="f"><label className="l" htmlFor="jobType">Job type</label>
          <select id="jobType" value={f.jobType} onChange={set('jobType')}>{JOB_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
        <div className="f w4">
          <label className="chip" style={{ alignSelf: 'flex-start' }}><input type="checkbox" checked={multi} onChange={(e) => { setMulti(e.target.checked); setDays(e.target.checked ? weekdaysFrom(f.date) : []); setConfirming(false); }} /> Same shift on several days (one text, temps choose their days)</label>
          {multi && (
            <div className="chips" style={{ marginTop: 8 }}>{Array.from({ length: 7 }, (_, i) => addDays(f.date, i)).map((x) => (
              <label className="chip" key={x}><input type="checkbox" checked={days.includes(x)} onChange={() => { setDays(days.includes(x) ? days.filter((y) => y !== x) : [...days, x].sort()); setConfirming(false); }} /> {label(x)}</label>
            ))}</div>
          )}
          {multi && <span className="note">Heads needed is per day. Temps reply with the days they can do, then you book people from the week view.</span>}
        </div>
        <div className="f w4"><label className="l" htmlFor="duties">Duties (one per line)</label><textarea id="duties" value={f.duties} onChange={set('duties')} /></div>
        <div className="f"><label className="l" htmlFor="pay">Pay (£/hr)</label><input id="pay" type="number" step="0.05" min="0" value={f.pay} onChange={set('pay')} /></div>
        <div className="f"><label className="l" htmlFor="heads">Heads needed</label><input id="heads" type="number" min="1" value={f.heads} onChange={set('heads')} /></div>
        <div className="f"><label className="l" htmlFor="radius">Within (miles)</label><input id="radius" type="number" min="1" max="100" value={f.radius} onChange={set('radius')} /></div>
        <div className="f w4"><span className="l">Temp must confirm they have</span>
          <div className="chips">{PPE_OPTIONS.map((p) => (
            <label className="chip" key={p}><input type="checkbox" checked={f.ppe.includes(p)}
              onChange={(e) => setF({ ...f, ppe: e.target.checked ? [...f.ppe, p] : f.ppe.filter((x) => x !== p) })} /> {p}</label>))}</div></div>
      </div>
      <div className="bar">
        <span className="note">{reach}</span>
        <div className="btnrow" style={{ alignItems: 'center' }}>
          {err && <p className="err">{err}</p>}
          {confirming && <button className="btn ghost" onClick={() => setConfirming(false)}>Back</button>}
          <button className="btn blue" disabled={pending || (multi && !days.length)} onClick={send}>{pending ? 'Sending…' : confirming ? 'Confirm and send texts' : multi ? `Send ${days.length}-day shift offer` : 'Send shift offer'}</button>
        </div>
      </div>
    </section>
  );
}
