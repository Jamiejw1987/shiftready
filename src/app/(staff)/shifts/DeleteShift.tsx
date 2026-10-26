'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteShift } from './actions';

export function DeleteShift({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState('');
  if (!confirm) return <><button className="btn ghost small" onClick={() => { setErr(''); setConfirm(true); }}>Delete</button>{err && <span className="err"> {err}</span>}</>;
  return (
    <span className="btnrow">
      <button className="btn small" style={{ background: 'var(--bad)' }} disabled={pending} onClick={() => start(async () => {
        const r = await deleteShift(id);
        if (!r.ok) { setErr(r.error ?? 'Couldn’t delete.'); setConfirm(false); }
        router.refresh();
      })}>Confirm delete</button>
      <button className="btn ghost small" onClick={() => setConfirm(false)}>Keep</button>
    </span>
  );
}
