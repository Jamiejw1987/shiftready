'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { acknowledgeRequest, officeCancelRequest } from '../actions';

export function RequestActions({ id, canAck, canCancel }: { id: string; canAck: boolean; canCancel: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => start(async () => {
    const r = await fn();
    setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Done.' : r.error ?? 'Something went wrong.' });
    if (r.ok) { setCancelling(false); router.refresh(); }
  });
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
      <span className="btnrow">
        {canAck && <button className="btn ghost" disabled={pending} onClick={() => run(() => acknowledgeRequest(id))}>I’m on it</button>}
        {canCancel && !cancelling && <button className="btn ghost" onClick={() => setCancelling(true)}>Can’t fill it</button>}
      </span>
      {cancelling && (
        <span className="compose" style={{ margin: 0, minWidth: 280 }}>
          <label className="l" htmlFor="ocr">Message to the client</label>
          <input id="ocr" type="text" placeholder="e.g. We can’t cover this one at such short notice" value={reason} onChange={(e) => setReason(e.target.value)} />
          <span className="btnrow" style={{ justifyContent: 'flex-end' }}>
            <button className="btn ghost small" onClick={() => setCancelling(false)}>Back</button>
            <button className="btn small" style={{ background: 'var(--bad)' }} disabled={pending} onClick={() => run(() => officeCancelRequest(id, reason))}>Cancel and email them</button>
          </span>
        </span>
      )}
      {msg && <span className={msg.ok ? 'okmsg' : 'err'}>{msg.text}</span>}
    </span>
  );
}
