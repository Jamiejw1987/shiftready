'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { confirmByPhone } from '../actions';

/** For a booked temp who hasn't replied: the office has called them and they're coming. Nothing is texted. */
export function ConfirmByPhone({ offerId, first }: { offerId: string; first: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState('');
  return (
    <>
      <br />
      <button className="btn blue small" style={{ marginTop: 6 }} disabled={pending}
        title={`You've called ${first} and they're coming. Confirms them now; no text is sent.`}
        onClick={() => start(async () => {
          const r = await confirmByPhone(offerId);
          if (!r.ok) setErr(r.error ?? 'Couldn’t confirm.');
          router.refresh();
        })}>{pending ? 'Confirming…' : `✓ Confirmed by phone`}</button>
      {err && <><br /><span className="err">{err}</span></>}
    </>
  );
}
