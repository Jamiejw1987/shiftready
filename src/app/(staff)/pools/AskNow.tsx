'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { askAvailabilityNow } from './actions';

/** Admins: send the weekly availability text now instead of waiting for Friday 8am. Nobody is asked twice. */
export function AskNow({ week }: { week: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState('');
  return (
    <span className="btnrow" style={{ alignItems: 'center' }}>
      <button className="btn ghost small" disabled={pending} onClick={() => {
        if (!confirm(`Text everyone in every pool now, asking which days they want shifts ${week}? Anyone already asked won’t get it again.`)) return;
        start(async () => { const r = await askAvailabilityNow(); setMsg(r.ok ? r.message! : r.error!); router.refresh(); });
      }}>{pending ? 'Sending…' : `Send now (${week})`}</button>
      {msg && <span className="note">{msg}</span>}
    </span>
  );
}
