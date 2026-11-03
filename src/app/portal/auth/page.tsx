'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/browser';
import { Logo } from '@/components/Logo';

/**
 * Where sign-in emails land. The link is only used when the person presses the button, because email
 * security scanners open links automatically and would otherwise use up the one-time link before they do.
 */
export default function PortalAuth() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function go() {
    setBusy(true);
    const q = new URLSearchParams(window.location.search);
    const token = q.get('token_hash');
    const type = (q.get('type') || 'magiclink') as EmailOtpType;
    const supabase = createClient();
    const { error } = token ? await supabase.auth.verifyOtp({ token_hash: token, type }) : { error: new Error('no token') };
    if (error) { setFailed(true); setBusy(false); return; }
    router.replace('/portal');
    router.refresh();
  }

  return (
    <main className="center">
      <div className="lcard">
        <Logo />
        {failed ? (
          <>
            <h1>Link expired</h1>
            <p className="lede" style={{ margin: 0 }}>This link has expired or was already used. You can get a new one in a few seconds.</p>
            <a className="btn blue" href="/portal/login">Get a new link</a>
          </>
        ) : (
          <>
            <h1>Welcome to ShiftReady</h1>
            <p className="lede" style={{ margin: 0 }}>Request shifts, see who’s booked and mark attendance.</p>
            <button className="btn blue" disabled={busy} onClick={go}>{busy ? 'Signing in…' : 'Sign in'}</button>
          </>
        )}
      </div>
    </main>
  );
}
