'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveJob, type JobInput } from './actions';

const empty: JobInput = { clientId: '', clientName: '', role: '', heads: '1', payRate: '', chargeRate: '', shiftPattern: '', startDate: '', location: '', requirements: '', notes: '' };

/** Add or edit a job that needs filling. */
export function JobForm({ clients, admin, job, onDone }: { clients: { id: string; name: string }[]; admin: boolean; job?: { id: string } & JobInput; onDone?: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [f, setF] = useState<JobInput>(job ?? empty);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof JobInput, v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <div className="form">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
        <div className="f"><label className="l" htmlFor="jc">Client</label>
          <select id="jc" value={f.clientId} onChange={(e) => set('clientId', e.target.value)}>
            <option value="">Not on ShiftReady (type below)</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></div>
        {!f.clientId && <div className="f"><label className="l" htmlFor="jcn">Client name</label><input id="jcn" value={f.clientName} onChange={(e) => set('clientName', e.target.value)} /></div>}
        <div className="f"><label className="l" htmlFor="jr">What they need</label><input id="jr" value={f.role} placeholder="Warehouse Operative" onChange={(e) => set('role', e.target.value)} /></div>
        <div className="f"><label className="l" htmlFor="jh">How many</label><input id="jh" type="number" min={1} inputMode="numeric" value={f.heads} onChange={(e) => set('heads', e.target.value)} /></div>
        <div className="f"><label className="l" htmlFor="jp">Pay rate (£/hr)</label><input id="jp" inputMode="decimal" value={f.payRate} placeholder="12.21" onChange={(e) => set('payRate', e.target.value)} /></div>
        {admin && <div className="f"><label className="l" htmlFor="jcr">Charge rate (£/hr) <span className="note">admins only</span></label><input id="jcr" inputMode="decimal" value={f.chargeRate} onChange={(e) => set('chargeRate', e.target.value)} /></div>}
        <div className="f"><label className="l" htmlFor="js">Shifts</label><input id="js" value={f.shiftPattern} placeholder="Nights 18:30-03:00, Mon-Fri" onChange={(e) => set('shiftPattern', e.target.value)} /></div>
        <div className="f"><label className="l" htmlFor="jd">Start date</label><input id="jd" type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} /></div>
        <div className="f"><label className="l" htmlFor="jl">Site / postcode</label><input id="jl" value={f.location} placeholder="Rowley Road, CV3 4LE" onChange={(e) => set('location', e.target.value)} /></div>
      </div>
      <div className="f" style={{ marginTop: 12 }}><label className="l" htmlFor="jq">Requirements <span className="note">tickets, PPE, experience</span></label><input id="jq" value={f.requirements} onChange={(e) => set('requirements', e.target.value)} /></div>
      <div className="f" style={{ marginTop: 12 }}><label className="l" htmlFor="jn">Notes</label><textarea id="jn" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></div>
      <div className="btnrow" style={{ marginTop: 12 }}>
        <button className="btn blue" disabled={pending} onClick={() => start(async () => {
          const r = await saveJob(job?.id ?? null, f);
          setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Saved.' : r.error ?? 'Something went wrong.' });
          if (r.ok) { if (!job) setF(empty); router.refresh(); onDone?.(); }
        })}>{pending ? 'Saving…' : job ? 'Save changes' : 'Add job'}</button>
        {onDone && <button className="btn ghost" onClick={onDone}>Cancel</button>}
      </div>
      {msg && <p className={msg.ok ? 'okmsg' : 'err'} style={{ marginTop: 10 }}>{msg.text}</p>}
    </div>
  );
}

export function NewJob({ clients, admin }: { clients: { id: string; name: string }[]; admin: boolean }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button className="btn blue" onClick={() => setOpen(true)}>Add a job</button>;
  return <JobForm clients={clients} admin={admin} onDone={() => setOpen(false)} />;
}
