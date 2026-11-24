'use client';
import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setJobStatus, deleteJob, findTempsForJob, addCandidate, setCandidate, type JobInput } from '../actions';
import { JobForm } from '../JobForm';
import { TempLink } from '@/components/TempLink';

type Msg = { ok: boolean; text: string } | null;
function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) =>
    start(async () => { const r = await fn(); setMsg(r.message || r.error ? { ok: r.ok, text: r.ok ? r.message ?? '' : r.error ?? '' } : null); if (r.ok) after?.(); router.refresh(); });
  return { pending, msg, setMsg, run, router };
}
const Note = ({ m }: { m: Msg }) => (m ? <p className={m.ok ? 'okmsg' : 'err'} style={{ marginTop: 10 }}>{m.text}</p> : null);

export function JobActions({ id, status, placed, heads, admin }: { id: string; status: string; placed: number; heads: number; admin: boolean }) {
  const { pending, msg, run, router } = useRun();
  return (
    <>
      <div className="btnrow">
        {status === 'open' && <button className={`btn ${placed >= heads ? 'blue' : 'ghost'}`} disabled={pending} onClick={() => run(() => setJobStatus(id, 'filled'))}>Mark as filled</button>}
        {status !== 'open' && <button className="btn blue" disabled={pending} onClick={() => run(() => setJobStatus(id, 'open'))}>Reopen</button>}
        {status !== 'closed' && <button className="btn ghost" disabled={pending} onClick={() => run(() => setJobStatus(id, 'closed'))}>Close (no longer needed)</button>}
        {admin && <button className="btn ghost danger" disabled={pending} onClick={() => { if (confirm('Delete this job and its candidate list? Use Close instead to keep a record.')) run(() => deleteJob(id), () => router.push('/jobs')); }}>Delete</button>}
      </div>
      <Note m={msg} />
    </>
  );
}

export function EditJob({ clients, admin, job }: { clients: { id: string; name: string }[]; admin: boolean; job: { id: string } & JobInput }) {
  const [open, setOpen] = useState(false);
  return open ? <div style={{ marginTop: 14 }}><JobForm clients={clients} admin={admin} job={job} onDone={() => setOpen(false)} /></div>
    : <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => setOpen(true)}>Edit job</button>;
}

const LABEL: Record<string, [string, string]> = { proposed: ['warn', 'Put forward'], confirmed: ['blue', 'Confirmed'], started: ['ok', 'Started'], dropped: ['mute', 'Dropped out'] };

export function Candidates({ list }: { list: { id: string; tempId: string; status: string; name: string; mobile: string; postcode: string | null }[] }) {
  const { pending, run } = useRun();
  if (!list.length) return <p className="note">Nobody added yet.</p>;
  return (
    <div className="tablewrap" style={{ marginBottom: 14 }}><table>
      <tbody>
        {list.map((c) => {
          const [k, l] = LABEL[c.status] ?? LABEL.proposed;
          return (
            <tr key={c.id}>
              <td><Link href={`/temps/${c.tempId}`}><b>{c.name}</b></Link> <span className={`pill ${k}`}>{l}</span><br /><span className="note">{c.mobile}{c.postcode ? ` · ${c.postcode}` : ''}</span></td>
              <td style={{ textAlign: 'right' }}>
                <select aria-label={`Status for ${c.name}`} value={c.status} disabled={pending} onChange={(e) => run(() => setCandidate(c.id, e.target.value as 'proposed'))} style={{ width: 'auto' }}>
                  <option value="proposed">Put forward</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="started">Started</option>
                  <option value="dropped">Dropped out</option>
                </select>{' '}
                <button className="btn ghost small" disabled={pending} onClick={() => { if (confirm(`Take ${c.name} off this job?`)) run(() => setCandidate(c.id, 'remove')); }}>Remove</button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table></div>
  );
}

type Hit = Awaited<ReturnType<typeof findTempsForJob>>[number];
export function AddCandidate({ jobId }: { jobId: string }) {
  const { pending, msg, setMsg, run } = useRun();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [as, setAs] = useState<'proposed' | 'confirmed'>('proposed');
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => setHits(await findTempsForJob(jobId, q)), 300);
    return () => clearTimeout(t);
  }, [jobId, q]);
  return (
    <div className="compose" style={{ marginBottom: 0 }}>
      <h3 style={{ margin: 0 }}>Add a candidate</h3>
      <input type="search" aria-label="Find a temp" placeholder="Search name or mobile" value={q} onChange={(e) => { setQ(e.target.value); setMsg(null); }} autoComplete="off" />
      {hits.map((h) => (
        <div key={h.id} className="slot" style={{ marginTop: 0 }}>
          <span><TempLink id={h.id} newTab><b>{h.name}</b></TempLink> <span className="note">{h.mobile}{h.postcode ? ` · ${h.postcode}` : ''}</span>{h.status !== 'active' && <> <span className="pill mute">{h.status === 'invited' || h.status === 'review' ? 'Not registered yet' : h.status === 'hold' ? 'On hold' : 'Not opted in'}</span></>}</span>
          {h.onJob ? <span className="pill mute">Already on this job</span> : (
            <button className="btn blue small" disabled={pending} onClick={() => run(() => addCandidate(jobId, h.id, as), () => { setQ(''); setHits([]); })}>Add</button>
          )}
        </div>
      ))}
      {q.trim().length >= 2 && !hits.length && <span className="note">No temps found.</span>}
      <div className="f" style={{ maxWidth: 320 }}><label className="l" htmlFor="addAs">Add them as</label>
        <select id="addAs" value={as} onChange={(e) => setAs(e.target.value as 'proposed' | 'confirmed')}>
          <option value="proposed">Put forward</option>
          <option value="confirmed">Confirmed</option>
        </select></div>
      <Note m={msg} />
    </div>
  );
}
