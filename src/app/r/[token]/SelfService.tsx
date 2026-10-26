'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { requestHoliday, requestP45 } from './requests';

export type MyRequest = {
  id: string; kind: 'holiday' | 'p45'; status: 'pending' | 'approved' | 'declined' | 'done';
  start_date: string | null; end_date: string | null; days: number | null; last_day: string | null; delivery: string | null;
  response_note: string | null; created_at: string;
};

const day = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const LABEL: Record<MyRequest['status'], [string, string]> = { pending: ['warn', 'Waiting'], approved: ['ok', 'Approved'], declined: ['bad', 'Declined'], done: ['ok', 'Sent'] };

export function SelfService({ token, requests }: { token: string; requests: MyRequest[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<'' | 'holiday' | 'p45'>('');
  const [h, setH] = useState({ start: '', end: '', days: '', note: '' });
  const [p, setP] = useState({ lastDay: '', delivery: 'email' as 'email' | 'post', note: '' });
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const todayIso = new Date().toLocaleDateString('en-CA');

  // Terms: give at least twice as much notice as the holiday you want to take.
  const noticeShort = (() => {
    if (!h.start || !h.days) return false;
    const daysUntil = Math.round((Date.parse(h.start) - Date.parse(todayIso)) / 864e5);
    return daysUntil < 2 * parseFloat(h.days);
  })();

  function send() {
    setErr('');
    start(async () => {
      const r = mode === 'holiday' ? await requestHoliday(token, h) : await requestP45(token, p);
      if (!r.ok) return setErr(r.error ?? 'Something went wrong.');
      setOk(mode === 'holiday' ? 'Holiday request sent. We’ll text you when it’s been looked at.' : 'P45 request sent. We’ll text you when it’s on its way.');
      setMode(''); setH({ start: '', end: '', days: '', note: '' }); setP({ lastDay: '', delivery: 'email', note: '' });
      router.refresh();
    });
  }

  return (
    <div className="card"><div className="in">
      <h3 style={{ margin: 0 }}>Holiday and P45</h3>
      {ok && <p className="okmsg">{ok}</p>}
      {mode === '' && (
        <div className="actions">
          <button className="btn blue" onClick={() => { setMode('holiday'); setOk(''); }}>Request holiday</button>
          <button className="btn ghost" onClick={() => { setMode('p45'); setOk(''); }}>Request my P45</button>
        </div>
      )}
      {mode === 'holiday' && (
        <>
          <div className="form">
            <div className="f w2"><label className="l" htmlFor="hs">First day off</label><input id="hs" type="date" min={todayIso} value={h.start} onChange={(e) => setH({ ...h, start: e.target.value, end: h.end && h.end >= e.target.value ? h.end : e.target.value })} /></div>
            <div className="f w2"><label className="l" htmlFor="he">Last day off</label><input id="he" type="date" min={h.start || todayIso} value={h.end} onChange={(e) => setH({ ...h, end: e.target.value })} /></div>
            <div className="f w4"><label className="l" htmlFor="hd">Working days you’ll miss</label><input id="hd" type="number" inputMode="decimal" min="0.5" step="0.5" placeholder="e.g. 3" value={h.days} onChange={(e) => setH({ ...h, days: e.target.value })} /></div>
            <div className="f w4"><label className="l" htmlFor="hn">Anything we should know? <span className="note">(optional)</span></label><input id="hn" type="text" value={h.note} onChange={(e) => setH({ ...h, note: e.target.value })} /></div>
          </div>
          {noticeShort && <p className="alert">Please try to give at least twice as much notice as the holiday you’re taking. You can still send it, but it may be harder to approve.</p>}
          <p className="note" style={{ margin: 0 }}>Holiday is paid from the holiday you’ve built up by working. Payroll will check your balance.</p>
        </>
      )}
      {mode === 'p45' && (
        <>
          <p style={{ margin: 0 }}>Your P45 shows your pay and tax when you stop working with us. You’ll need it for your next job.</p>
          <div className="f"><label className="l" htmlFor="pl">Your last day working with us</label><input id="pl" type="date" value={p.lastDay} onChange={(e) => setP({ ...p, lastDay: e.target.value })} /></div>
          <div className="f"><span className="l">How should we send it?</span>
            <div className="yn">
              <label className="tick"><input type="radio" name="dl" checked={p.delivery === 'email'} onChange={() => setP({ ...p, delivery: 'email' })} /> Email</label>
              <label className="tick"><input type="radio" name="dl" checked={p.delivery === 'post'} onChange={() => setP({ ...p, delivery: 'post' })} /> Post</label>
            </div>
            <span className="note">We’ll use the email or address you gave when you registered. If they’ve changed, say below.</span></div>
          <div className="f"><label className="l" htmlFor="pn">Anything else? <span className="note">(optional)</span></label><input id="pn" type="text" value={p.note} onChange={(e) => setP({ ...p, note: e.target.value })} /></div>
        </>
      )}
      {mode !== '' && (
        <>
          {err && <p className="err">{err}</p>}
          <div className="actions"><button className="btn ghost" onClick={() => { setMode(''); setErr(''); }}>Back</button>
            <button className="btn blue" disabled={pending} onClick={send}>{pending ? 'Sending…' : 'Send request'}</button></div>
        </>
      )}
      {requests.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h3 style={{ margin: '6px 0 0' }}>Your requests</h3>
          {requests.map((r) => (
            <div key={r.id} className="slot" style={{ marginTop: 0 }}>
              <span>
                {r.kind === 'holiday' ? <>Holiday: {r.start_date === r.end_date ? day(r.start_date!) : `${day(r.start_date!)} to ${day(r.end_date!)}`} ({Number(r.days)} day{Number(r.days) === 1 ? '' : 's'})</> : <>P45 by {r.delivery}</>}
                {r.response_note && <><br /><span className="note">{r.response_note}</span></>}
              </span>
              <span className={`pill ${LABEL[r.status][0]}`}>{r.kind === 'p45' && r.status === 'done' ? 'Sent' : LABEL[r.status][1]}</span>
            </div>
          ))}
        </div>
      )}
    </div></div>
  );
}
