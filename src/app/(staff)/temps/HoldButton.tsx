'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setTempStatus } from './actions';

/**
 * Put on hold / take off hold, with a choice of texting them or doing it quietly.
 * On hold: no shift offers and they can't accept any until the office takes them off hold.
 */
export function HoldButton({ id, first, status, onDone }: { id: string; first: string; status: string; onDone?: (msg: string, ok: boolean) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (status !== 'active' && status !== 'hold') return null;
  const hold = status === 'active';

  const go = (tell: boolean) => start(async () => {
    const r = await setTempStatus(id, hold ? 'hold' : 'active', tell);
    const text = r.ok ? (r.message ?? 'Done.') : (r.error ?? 'Couldn’t update.');
    setOpen(false);
    if (onDone) onDone(text, r.ok); else setMsg({ ok: r.ok, text });
    router.refresh();
  });

  return (
    <>
      {!open ? (
        <button className="btn ghost small" disabled={pending} onClick={() => { setOpen(true); setMsg(null); }}>{hold ? 'Put on hold' : 'Take off hold'}</button>
      ) : (
        <span className="btnrow" style={{ alignItems: 'center' }}>
          <button className="btn small" style={hold ? { background: 'var(--bad)' } : undefined} disabled={pending} onClick={() => go(true)}
            title={hold ? `Texts ${first}: they've been placed on hold and won't get shifts until they contact the office` : `Texts ${first}: they're off hold and will get shifts again`}>
            {pending ? 'Saving…' : hold ? `Hold & text ${first}` : `Take off hold & text ${first}`}
          </button>
          <button className="btn ghost small" disabled={pending} onClick={() => go(false)}>{hold ? 'Hold without texting' : 'Without texting'}</button>
          <button className="btn ghost small" disabled={pending} onClick={() => setOpen(false)}>Back</button>
        </span>
      )}
      {msg && <span className={msg.ok ? 'okmsg' : 'err'}>{msg.text}</span>}
    </>
  );
}
