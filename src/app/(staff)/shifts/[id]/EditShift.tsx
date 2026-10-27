'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { PPE_OPTIONS } from '@/lib/format';
import { updateShift } from '../actions';

type Props = { id: string; heads: number; pay: number; start: string; end: string; duties: string[]; ppe: string[]; booked: number };

export function EditShift(p: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const init = () => ({ heads: String(p.heads), pay: p.pay.toFixed(2), start: p.start.slice(0, 5), end: p.end.slice(0, 5), duties: p.duties.join('\n'), ppe: p.ppe, notify: true });
  const [f, setF] = useState(init);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof ReturnType<typeof init>) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  if (!open) return (
    <>
      <button className="btn ghost" onClick={() => { setF(init()); setOpen(true); setMsg(null); }}>Edit shift</button>
      {msg && <p className={msg.ok ? 'okmsg' : 'err'} style={{ marginTop: 10 }}>{msg.text}</p>}
    </>
  );
  return (
    <div className="compose" style={{ marginTop: 14, marginBottom: 0 }}>
      <h3 style={{ margin: 0 }}>Edit shift</h3>
      <div className="form">
        <div className="f"><label className="l" htmlFor="eHeads">People needed</label><input id="eHeads" type="number" min={Math.max(1, p.booked)} max="200" value={f.heads} onChange={set('heads')} /></div>
        <div className="f"><label className="l" htmlFor="ePay">Pay £/hr</label><input id="ePay" type="number" step="0.01" min="0" value={f.pay} onChange={set('pay')} /></div>
        <div className="f"><label className="l" htmlFor="eStart">Start</label><input id="eStart" type="time" value={f.start} onChange={set('start')} /></div>
        <div className="f"><label className="l" htmlFor="eEnd">Finish</label><input id="eEnd" type="time" value={f.end} onChange={set('end')} /></div>
        <div className="f w4"><label className="l" htmlFor="eDuties">Duties (one per line)</label><textarea id="eDuties" value={f.duties} onChange={set('duties')} /></div>
        <div className="f w4"><span className="l">They must have</span>
          <div className="chips">{PPE_OPTIONS.map((x) => (
            <label key={x} className="chip"><input type="checkbox" checked={f.ppe.includes(x)} onChange={() => setF({ ...f, ppe: f.ppe.includes(x) ? f.ppe.filter((y) => y !== x) : [...f.ppe, x] })} /> {x}</label>
          ))}</div></div>
      </div>
      {p.booked > 0 && <label className="chip" style={{ alignSelf: 'flex-start' }}><input type="checkbox" checked={f.notify} onChange={(e) => setF({ ...f, notify: e.target.checked })} /> Text the {p.booked} booked temp{p.booked === 1 ? '' : 's'} if the pay, times or PPE change</label>}
      <p className="note" style={{ margin: 0 }}>Adding places offers them to people on standby first, in order.</p>
      {msg && <p className={msg.ok ? 'okmsg' : 'err'}>{msg.text}</p>}
      <div className="btnrow" style={{ justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
        <button className="btn blue" disabled={pending} onClick={() => start(async () => {
          const r = await updateShift(p.id, { heads: Number(f.heads), pay: Number(f.pay), start: f.start, end: f.end, duties: f.duties, ppe: f.ppe, notify: f.notify });
          setMsg({ ok: r.ok, text: r.ok ? r.message! : r.error! });
          if (r.ok) { setOpen(false); router.refresh(); }
        })}>{pending ? 'Saving…' : 'Save changes'}</button>
      </div>
    </div>
  );
}
