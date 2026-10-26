'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { noShow, cancelShift } from '../actions';

export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') router.refresh(); }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}

export function BoardActions({ kind, id }: { kind: 'noshow' | 'cancel'; id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState('');
  const label = kind === 'noshow' ? 'Mark no-show' : 'Cancel shift';
  const confirmLabel = kind === 'noshow' ? 'Confirm no-show and text them' : 'Yes, cancel and text booked temps';

  function run() {
    if (!confirm) return setConfirm(true);
    start(async () => {
      const r = kind === 'noshow' ? await noShow(id) : await cancelShift(id);
      if (!r.ok) setErr(r.error ?? 'Something went wrong.');
      setConfirm(false);
      router.refresh();
    });
  }

  return (
    <span className="btnrow" style={{ alignItems: 'center' }}>
      {err && <span className="err">{err}</span>}
      {confirm && <button className="btn ghost small" onClick={() => setConfirm(false)}>Back</button>}
      <button className={confirm ? 'btn small' : 'btn ghost small'} style={confirm ? { background: 'var(--bad)' } : undefined} disabled={pending} onClick={run}>
        {confirm ? confirmLabel : label}
      </button>
    </span>
  );
}
