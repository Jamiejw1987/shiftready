'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { removeRegistration } from './actions';

/** Remove from Ready to check, with a confirm step. Nobody is texted. */
export function RemoveRegistration({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState(false);
  const [err, setErr] = useState('');
  if (!asking) return <button className="btn ghost small" onClick={() => { setAsking(true); setErr(''); }}>Remove</button>;
  return (
    <>
      <button className="btn small" style={{ background: 'var(--bad)' }} disabled={pending}
        title={`Deletes ${name}'s registration, ID and documents. They aren't texted and can register again later.`}
        onClick={() => start(async () => {
          const r = await removeRegistration(id);
          if (!r.ok) { setErr(r.error ?? 'Couldn’t remove.'); setAsking(false); }
          router.refresh();
        })}>{pending ? 'Removing…' : 'Yes, remove'}</button>
      <button className="btn ghost small" disabled={pending} onClick={() => setAsking(false)}>Keep</button>
      {err && <span className="err">{err}</span>}
    </>
  );
}
