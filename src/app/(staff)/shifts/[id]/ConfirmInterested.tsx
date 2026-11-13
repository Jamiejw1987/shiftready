'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addToShift } from '../actions';

/** After the office has spoken to them: books an interested temp on and texts them asking them to reply YES to confirm. */
export function ConfirmInterested({ shiftId, tempId, first }: { shiftId: string; tempId: string; first: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState('');
  return (
    <span className="btnrow" style={{ alignItems: 'center' }}>
      {err && <span className="err">{err}</span>}
      <button className="btn blue small" disabled={pending} onClick={() => start(async () => {
        const r = await addToShift(shiftId, tempId, 'ask');
        if (!r.ok) setErr(r.error ?? 'Couldn’t confirm.');
        router.refresh();
      })}>{pending ? 'Booking…' : `Book ${first} & ask to confirm`}</button>
    </span>
  );
}
