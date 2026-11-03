'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Reloads the planner's data every 30 seconds so it can be left up on a screen. */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') router.refresh(); }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
