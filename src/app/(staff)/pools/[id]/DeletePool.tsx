'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deletePool } from '../actions';

export function DeletePool({ poolId, name }: { poolId: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <p style={{ margin: '18px 0 0' }}>
      <button className="btn ghost danger small" disabled={pending} onClick={() => {
        if (!confirm(`Delete the ${name} pool? Nobody is texted. It comes back if someone is booked on a shift here again.`)) return;
        start(async () => { const r = await deletePool(poolId); if (r.ok) router.push('/pools'); else alert(r.error); });
      }}>Delete pool</button>
    </p>
  );
}
