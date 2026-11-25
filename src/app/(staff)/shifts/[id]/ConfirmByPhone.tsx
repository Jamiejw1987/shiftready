'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { confirmByPhone } from '../actions';

/**
 * For a booked temp who hasn't replied: "Confirmed by phone?" (white). Once pressed it turns green,
 * "✓ Confirmed by phone", and stays that way. Nothing is texted to the temp.
 */
export function ConfirmByPhone({ offerId, first, done: doneProp = false }: { offerId: string; first: string; done?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState(doneProp);
  const [err, setErr] = useState('');
  useEffect(() => setDone(doneProp), [doneProp]);

  if (done) return <><br /><span className="phone-ok" title="Confirmed by phone. No text was sent.">✓ Confirmed by phone</span></>;
  return (
    <>
      <br />
      <button className="btn ghost small phone-ask" disabled={pending}
        title={`You've called ${first} and they're coming. Confirms them now; no text is sent.`}
        onClick={() => start(async () => {
          const r = await confirmByPhone(offerId);
          if (r.ok) setDone(true); else setErr(r.error ?? 'Couldn’t confirm.');
          router.refresh();
        })}>{pending ? 'Confirming…' : 'Confirmed by phone?'}</button>
      {err && <><br /><span className="err">{err}</span></>}
    </>
  );
}
