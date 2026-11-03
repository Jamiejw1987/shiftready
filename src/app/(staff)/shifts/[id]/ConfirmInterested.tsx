'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addToShift } from '../actions';

/** Books an interested temp onto a client-requested shift and texts them that they're booked. */
export function ConfirmInterested({ shiftId, tempId, first }: { shiftId: string; tempId: string; first: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState('');
  return (
    <span className="btnrow" style={{ alignItems: 'center' }}>
      {err && <span className="err">{err}</span>}
      <button className="btn blue small" disabled={pending} onClick={() => start(async () => {
        const r = await addToShift(shiftId, tempId, 'tell');
        if (!r.ok) setErr(r.error ?? 'Couldn’t confirm.');
        router.refresh();
      })}>{pending ? 'Confirming…' : `Confirm ${first}`}</button>
    </span>
  );
}
