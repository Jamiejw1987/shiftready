'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { seriesCancel, seriesDelete } from '../../actions';

export function WeekActions({ seriesId, canCancel, admin, redirectAfterDelete = true }: { seriesId: string; canCancel: boolean; admin: boolean; redirectAfterDelete?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState<'' | 'cancel' | 'delete'>('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (kind: 'cancel' | 'delete') => start(async () => {
    const r = kind === 'cancel' ? await seriesCancel(seriesId) : await seriesDelete(seriesId);
    setConfirm('');
    if (!r.ok) return setMsg({ ok: false, text: r.error! });
    if (kind === 'delete') { if (redirectAfterDelete) router.push('/shifts'); else router.refresh(); return; }
    setMsg({ ok: true, text: (r as { message?: string }).message ?? 'Done.' });
    router.refresh();
  });
  return (
    <span className="btnrow" style={{ alignItems: 'center' }}>
      {msg && <span className={msg.ok ? 'okmsg' : 'err'}>{msg.text}</span>}
      {confirm ? (
        <>
          <button className="btn ghost small" onClick={() => setConfirm('')}>Back</button>
          <button className="btn small" style={{ background: 'var(--bad)' }} disabled={pending} onClick={() => run(confirm)}>
            {confirm === 'cancel' ? 'Yes, cancel every day and text booked temps' : 'Yes, delete this week'}
          </button>
        </>
      ) : (
        <>
          {canCancel && <button className="btn ghost small" onClick={() => { setMsg(null); setConfirm('cancel'); }}>Cancel whole week</button>}
          {admin && <button className="btn ghost small" onClick={() => { setMsg(null); setConfirm('delete'); }}>Delete week</button>}
        </>
      )}
    </span>
  );
}
