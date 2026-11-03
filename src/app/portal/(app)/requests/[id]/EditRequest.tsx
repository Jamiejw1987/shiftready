'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { JOB_TYPES } from '@/lib/format';
import { updateRequest, cancelRequest } from '../../../actions';

type V = { date: string; start: string; end: string; role: string; headcount: number; notes: string };

export function EditRequest({ id, initial, hasShift, booked, canCancel, cutoff }: { id: string; initial: V; hasShift: boolean; booked: number; canCancel: boolean; cutoff: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState<'edit' | 'cancel' | null>(null);
  const [v, setV] = useState(initial);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => start(async () => {
    const r = await fn();
    setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Done.' : r.error ?? 'Something went wrong.' });
    if (r.ok) { setOpen(null); router.refresh(); }
  });

  return (
    <div style={{ marginTop: 14 }}>
      {!open && (
        <div className="btnrow">
          <button className="btn ghost" onClick={() => { setOpen('edit'); setMsg(null); }}>Change</button>
          {canCancel
            ? <button className="btn ghost" onClick={() => { setOpen('cancel'); setMsg(null); }}>Cancel this shift</button>
            : <span className="note">Starts in less than {cutoff} hours: call us to cancel.</span>}
        </div>
      )}
      {open === 'edit' && (
        <div className="compose" style={{ marginBottom: 0 }}>
          {hasShift
            ? <p className="note" style={{ margin: 0 }}>We’re already booking people for this one, so you can change the number of people and notes here. For anything else, cancel and post a new request, or call us.</p>
            : null}
          <div className="form">
            {!hasShift && <>
              <div className="f"><label className="l" htmlFor="ed">Date</label><input id="ed" type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></div>
              <div className="f"><label className="l" htmlFor="es">Start</label><input id="es" type="time" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} /></div>
              <div className="f"><label className="l" htmlFor="ee">Finish</label><input id="ee" type="time" value={v.end} onChange={(e) => setV({ ...v, end: e.target.value })} /></div>
              <div className="f"><label className="l" htmlFor="er">Type of work</label><select id="er" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })}>{JOB_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
            </>}
            <div className="f"><label className="l" htmlFor="eh">People needed{booked ? ` (${booked} booked)` : ''}</label><input id="eh" type="number" min={Math.max(1, booked)} max={200} inputMode="numeric" value={v.headcount} onChange={(e) => setV({ ...v, headcount: parseInt(e.target.value) || 0 })} /></div>
            <div className="f w4"><label className="l" htmlFor="en">Notes</label><textarea id="en" value={v.notes} maxLength={500} onChange={(e) => setV({ ...v, notes: e.target.value })} /></div>
          </div>
          <div className="btnrow" style={{ justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={() => { setOpen(null); setV(initial); }}>Back</button>
            <button className="btn blue" disabled={pending} onClick={() => run(() => updateRequest(id, v))}>{pending ? 'Saving…' : 'Save changes'}</button>
          </div>
        </div>
      )}
      {open === 'cancel' && (
        <div className="compose" style={{ marginBottom: 0 }}>
          <b>Cancel this shift?</b>
          {booked > 0 && <p className="note" style={{ margin: 0 }}>{booked} {booked === 1 ? 'person is' : 'people are'} already booked. We’ll let them know.</p>}
          <div className="f"><label className="l" htmlFor="cr">Reason (optional)</label><input id="cr" type="text" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          <div className="btnrow" style={{ justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={() => setOpen(null)}>Keep it</button>
            <button className="btn" style={{ background: 'var(--bad)' }} disabled={pending} onClick={() => run(() => cancelRequest(id, reason))}>{pending ? 'Cancelling…' : 'Yes, cancel it'}</button>
          </div>
        </div>
      )}
      {msg && <p className={msg.ok ? 'okmsg' : 'err'} style={{ marginTop: 10 }}>{msg.text}</p>}
    </div>
  );
}
