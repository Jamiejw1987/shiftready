'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { findTempsForPool, addToPool } from '../actions';
import { TempLink } from '@/components/TempLink';

type Hit = Awaited<ReturnType<typeof findTempsForPool>>[number];

/** Add someone who hasn't been booked here yet, e.g. a regular who's said they'll cover this site. */
export function AddToPool({ poolId }: { poolId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) return setHits([]);
    const t = setTimeout(async () => setHits(await findTempsForPool(poolId, q)), 300);
    return () => clearTimeout(t);
  }, [poolId, q]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h3 style={{ margin: 0 }}>Add someone to this pool</h3>
      <p className="note" style={{ margin: 0 }}>People booked on a shift here are added automatically. Use this for anyone else who’s happy to work this site.</p>
      <input type="search" aria-label="Find a temp" placeholder="Search name or mobile" value={q} onChange={(e) => { setQ(e.target.value); setMsg(null); }} autoComplete="off" style={{ maxWidth: 420 }} />
      {hits.map((h) => (
        <div key={h.id} className="slot" style={{ marginTop: 0 }}>
          <span><TempLink id={h.id} newTab><b>{h.name}</b></TempLink> <span className="note">{h.mobile}{h.postcode ? ` · ${h.postcode}` : ''}</span></span>
          {h.inPool ? <span className="pill mute">Already in pool</span> : (
            <button className="btn blue small" disabled={pending} onClick={() => start(async () => {
              const r = await addToPool(poolId, h.id);
              setMsg({ ok: r.ok, text: r.ok ? r.message! : r.error! });
              if (r.ok) { setQ(''); setHits([]); router.refresh(); }
            })}>Add</button>
          )}
        </div>
      ))}
      {q.trim().length >= 2 && !hits.length && <span className="note">No temps found.</span>}
      {msg && <p className={msg.ok ? 'okmsg' : 'err'}>{msg.text}</p>}
    </div>
  );
}
