'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { removeRegistration, removeInvite } from './actions';

/**
 * Remove button with a confirm step. Nobody is texted.
 * kind 'review' = Ready to check; kind 'invited' = Links sent, not finished.
 */
export function RemoveRegistration({ id, name, kind = 'review' }: { id: string; name: string; kind?: 'review' | 'invited' }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState(false);
  const [err, setErr] = useState('');
  const title = kind === 'invited'
    ? `Deletes ${name} from ShiftReady so you can add them again (new name or number, or added manually). They aren't texted.`
    : `Deletes ${name}'s registration, ID and documents. They aren't texted and can register again later.`;
  if (!asking) return <>
    <button className="btn ghost small" onClick={() => { setAsking(true); setErr(''); }}>{kind === 'invited' ? 'Delete' : 'Remove'}</button>
    {err && <span className="err">{err}</span>}
  </>;
  return (
    <>
      <button className="btn small" style={{ background: 'var(--bad)' }} disabled={pending} title={title}
        onClick={() => start(async () => {
          const r = kind === 'invited' ? await removeInvite(id) : await removeRegistration(id);
          if (!r.ok) setErr(r.error ?? 'Couldn’t remove.');
          setAsking(false);
          router.refresh();
        })}>{pending ? 'Deleting…' : kind === 'invited' ? 'Yes, delete' : 'Yes, remove'}</button>
      <button className="btn ghost small" disabled={pending} onClick={() => setAsking(false)}>Keep</button>
    </>
  );
}
