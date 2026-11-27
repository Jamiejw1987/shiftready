'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { mergePool } from '../actions';

type Option = { id: string; label: string; count: number; sameClient: boolean };

/** Merge this pool into another one: for the same site entered two ways on shifts. */
export function MergePool({ poolId, name, options }: { poolId: string; name: string; options: Option[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [into, setInto] = useState('');
  const [err, setErr] = useState('');
  if (!options.length) return null;
  const target = options.find((o) => o.id === into);
  const same = options.filter((o) => o.sameClient), other = options.filter((o) => !o.sameClient);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 22 }}>
      <h3 style={{ margin: 0 }}>Merge into another pool</h3>
      <p className="note" style={{ margin: 0 }}>Same site showing as two pools (a small difference in the client name or postcode on a shift)? Merge this one into the right one. Everyone moves across with their usual days and weekly answers, and future shifts with this spelling go into that pool too.</p>
      <div className="btnrow" style={{ alignItems: 'center' }}>
        <select value={into} onChange={(e) => { setInto(e.target.value); setErr(''); }} aria-label="Pool to merge into" style={{ maxWidth: 420 }}>
          <option value="">Merge into…</option>
          {same.length > 0 && <optgroup label="Same client">{same.map((o) => <option key={o.id} value={o.id}>{o.label} ({o.count})</option>)}</optgroup>}
          {other.length > 0 && <optgroup label="Other clients">{other.map((o) => <option key={o.id} value={o.id}>{o.label} ({o.count})</option>)}</optgroup>}
        </select>
        <button className="btn blue small" disabled={pending || !into} onClick={() => {
          if (!confirm(`Merge ${name} into ${target?.label}? Everyone here moves across. This can’t be undone.`)) return;
          start(async () => {
            const r = await mergePool(poolId, into);
            if (!r.ok) return setErr(r.error ?? 'Couldn’t merge.');
            router.push(`/pools/${r.into}?merged=1`);
          });
        }}>{pending ? 'Merging…' : 'Merge'}</button>
      </div>
      {err && <p className="err" style={{ margin: 0 }}>{err}</p>}
    </div>
  );
}
