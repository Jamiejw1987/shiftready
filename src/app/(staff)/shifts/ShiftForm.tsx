'use client';
import { useEffect, useState, useTransition } from 'react';
import { JOB_TYPES, PPE_OPTIONS } from '@/lib/format';
import { createAndSendShift, previewReach } from './actions';

const tomorrow = () => new Date(Date.now() + 864e5).toISOString().slice(0, 10);

export function ShiftForm() {
  const [pending, start] = useTransition();
  const [f, setF] = useState({
    client: '', site: '', sitePostcode: '', date: tomorrow(), start: '06:00', end: '14:00',
    jobType: 'Warehouse', duties: '', pay: '', heads: '1', radius: '15', ppe: ['Safety boots', 'Hi-vis vest'] as string[],
  });
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
      const r = await createAndSendShift({ ...f, pay: parseFloat(f.pay), heads: parseInt(f.heads), radius: parseFloat(f.radius) });
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
        <div className="f"><label className="l" htmlFor="date">Date</label><input id="date" type="date" value={f.date} onChange={set('date')} /></div>
        <div className="f"><label className="l" htmlFor="start">Start</label><input id="start" type="time" value={f.start} onChange={set('start')} /></div>
        <div className="f"><label className="l" htmlFor="end">Finish</label><input id="end" type="time" value={f.end} onChange={set('end')} /></div>
        <div className="f"><label className="l" htmlFor="jobType">Job type</label>
          <select id="jobType" value={f.jobType} onChange={set('jobType')}>{JOB_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
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
          <button className="btn blue" disabled={pending} onClick={send}>{pending ? 'Sending…' : confirming ? 'Confirm and send texts' : 'Send shift offer'}</button>
        </div>
      </div>
    </section>
  );
}
