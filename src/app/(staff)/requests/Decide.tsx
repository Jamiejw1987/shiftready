'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { decide } from './actions';

export function Decide({ id, kind }: { id: string; kind: 'holiday' | 'p45' }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const go = (action: 'approve' | 'decline' | 'done') => start(async () => {
    setErr('');
    const r = await decide(id, action, note);
    if (!r.ok) return setErr(r.error ?? 'Something went wrong.');
    router.refresh();
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 240 }}>
      <input type="text" aria-label="Note to the temp" placeholder="Note to the temp (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="btnrow">
        {kind === 'holiday'
          ? <><button className="btn blue small" disabled={pending} onClick={() => go('approve')}>Approve</button><button className="btn ghost small" disabled={pending} onClick={() => go('decline')}>Decline</button></>
          : <><button className="btn blue small" disabled={pending} onClick={() => go('done')}>Mark P45 sent</button><button className="btn ghost small" disabled={pending} onClick={() => go('decline')}>Can’t send yet</button></>}
      </div>
      {err && <span className="err">{err}</span>}
    </div>
  );
}
