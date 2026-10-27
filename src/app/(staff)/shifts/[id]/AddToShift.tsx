'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { findTempsForShift, addToShift } from '../actions';

type Hit = Awaited<ReturnType<typeof findTempsForShift>>[number];

/** Book someone on by hand after they ring or text the office. */
export function AddToShift({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [textThem, setTextThem] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) return setHits([]);
    const t = setTimeout(async () => setHits(await findTempsForShift(id, q)), 300);
    return () => clearTimeout(t);
  }, [id, q]);

  return (
    <div className="compose" style={{ marginTop: 14, marginBottom: 0 }}>
      <h3 style={{ margin: 0 }}>Add someone by hand</h3>
      <p className="note" style={{ margin: 0 }}>For temps who rang or texted the office to take this shift.</p>
      <input type="search" aria-label="Find a temp" placeholder="Search name or mobile" value={q} onChange={(e) => { setQ(e.target.value); setMsg(null); }} autoComplete="off" />
      {hits.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {hits.map((h) => {
            const block = h.onShift ? 'Already booked on' : h.clash ? 'Booked elsewhere at this time' : h.status !== 'active' ? (h.status === 'hold' ? 'On hold' : 'Not opted in') : '';
            return (
              <div key={h.id} className="slot" style={{ marginTop: 0 }}>
                <span><b>{h.name}</b> <span className="note">{h.mobile}{h.postcode ? ` · ${h.postcode}` : ''}</span></span>
                {block ? <span className="pill mute">{block}</span> : (
                  <button className="btn blue small" disabled={pending} onClick={() => start(async () => {
                    const r = await addToShift(id, h.id, textThem);
                    setMsg({ ok: r.ok, text: r.ok ? r.message! : r.error! });
                    if (r.ok) { setQ(''); setHits([]); router.refresh(); }
                  })}>Book on</button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {q.trim().length >= 2 && !hits.length && <span className="note">No temps found.</span>}
      <label className="chip" style={{ alignSelf: 'flex-start' }}><input type="checkbox" checked={textThem} onChange={(e) => setTextThem(e.target.checked)} /> Text them a booking confirmation</label>
      {msg && <p className={msg.ok ? 'okmsg' : 'err'}>{msg.text}</p>}
    </div>
  );
}
