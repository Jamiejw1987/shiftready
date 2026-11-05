'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/browser';
import { Logo } from '@/components/Logo';

/**
 * Invite and password-reset emails land here. Works with Supabase's default email templates
 * (sign-in details arrive after the # in the address) as well as custom ones (?token_hash=...)
 * and reset links (?code=...). Signs the person in, then sends them to set a password.
 */
export default function ConfirmPage() {
  const router = useRouter();
  const [state, setState] = useState<'checking' | 'ready' | 'working' | 'failed'>('checking');
  const [tokenLink, setTokenLink] = useState<{ hash: string; type: EmailOtpType } | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const q = new URLSearchParams(window.location.search);
      const h = new URLSearchParams(window.location.hash.replace(/^#/, ''));

      // ShiftReady's own links: wait for a tap, so Outlook's link scanner opening the page first doesn't use them up.
      if (q.get('token_hash') && q.get('type')) {
        setTokenLink({ hash: q.get('token_hash')!, type: q.get('type') as EmailOtpType });
        setState('ready');
        return;
      }

      let ok = false;
      if (h.get('access_token') && h.get('refresh_token')) {
        ok = !(await supabase.auth.setSession({ access_token: h.get('access_token')!, refresh_token: h.get('refresh_token')! })).error;
      } else if (q.get('code')) {
        ok = !(await supabase.auth.exchangeCodeForSession(q.get('code')!)).error;
      }
      if (ok) router.replace('/auth/set-password');
      else setState('failed');
    })();
  }, [router]);

  async function go() {
    if (!tokenLink) return;
    setState('working');
    const supabase = createClient();
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenLink.hash, type: tokenLink.type });
    if (error) setState('failed');
    else router.replace('/auth/set-password');
  }

  return (
    <main className="center">
      <div className="lcard">
        <Logo />
        {state === 'failed' ? (
          <>
            <h1>Link expired</h1>
            <p className="lede" style={{ margin: 0 }}>This link has expired or was already used. On the sign-in page, type your email and press Forgotten password for a new one, or ask an admin to send you a link.</p>
            <a className="btn blue" href="/login">Go to sign in</a>
          </>
        ) : state === 'ready' || state === 'working' ? (
          <>
            <h1>Set your password</h1>
            <p className="lede" style={{ margin: 0 }}>Press continue to choose your ShiftReady password.</p>
            <button className="btn blue" disabled={state === 'working'} onClick={go}>{state === 'working' ? 'Checking…' : 'Continue'}</button>
          </>
        ) : (
          <p className="lede" style={{ margin: 0 }}>Checking your link…</p>
        )}
      </div>
    </main>
  );
}
