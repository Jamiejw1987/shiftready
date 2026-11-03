'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setMyEmailAlerts } from './actions';

export function AlertSettings({ emailOn }: { emailOn: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button className="btn ghost" disabled={pending} onClick={() => start(async () => { await setMyEmailAlerts(!emailOn); router.refresh(); })}>
      {emailOn ? 'Mute client emails' : 'Turn client emails back on'}
    </button>
  );
}
