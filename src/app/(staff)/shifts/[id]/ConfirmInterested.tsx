'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addToShift, passOver } from '../actions';

/**
 * After the office has spoken to them: books an interested temp on and texts them asking them to reply YES to confirm.
 * Or "Not this time": quietly takes them off this shift's list without telling them.
 */
export function ConfirmInterested({ shiftId, tempId, offerId, first, full }: { shiftId: string; tempId: string; offerId: string; first: string; full: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState('');
  const [asking, setAsking] = useState(false);
  return (
    <span className="btnrow" style={{ alignItems: 'center' }}>
      {err && <span className="err">{err}</span>}
      {!full && !asking && <button className="btn blue small" disabled={pending} onClick={() => start(async () => {
        const r = await addToShift(shiftId, tempId, 'ask');
        if (!r.ok) setErr(r.error ?? 'Couldn’t confirm.');
        router.refresh();
      })}>{pending ? 'Booking…' : `Book ${first} & ask to confirm`}</button>}
      {/* Pass over quietly: off this shift's list, no text, still gets other shifts. */}
      {asking && <button className="btn ghost small" disabled={pending} onClick={() => setAsking(false)}>Back</button>}
      <button className={asking ? 'btn small' : 'btn ghost small'} style={asking ? { background: 'var(--bad)' } : undefined} disabled={pending}
        title="Takes them off this shift only. They aren’t texted and still get other shifts."
        onClick={() => {
          if (!asking) return setAsking(true);
          start(async () => {
            const r = await passOver(offerId);
            if (!r.ok) setErr(r.error ?? 'Couldn’t update.');
            setAsking(false);
            router.refresh();
          });
        }}>{asking ? `Yes, pass over ${first} (not told)` : 'Not this time'}</button>
    </span>
  );
}
