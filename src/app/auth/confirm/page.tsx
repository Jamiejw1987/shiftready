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
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const q = new URLSearchParams(window.location.search);
      const h = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      let ok = false;

      if (h.get('access_token') && h.get('refresh_token')) {
        ok = !(await supabase.auth.setSession({ access_token: h.get('access_token')!, refresh_token: h.get('refresh_token')! })).error;
      } else if (q.get('token_hash') && q.get('type')) {
        ok = !(await supabase.auth.verifyOtp({ token_hash: q.get('token_hash')!, type: q.get('type') as EmailOtpType })).error;
      } else if (q.get('code')) {
        ok = !(await supabase.auth.exchangeCodeForSession(q.get('code')!)).error;
      }

      if (ok) router.replace('/auth/set-password');
      else setFailed(true);
    })();
  }, [router]);

  return (
    <main className="center">
      <div className="lcard">
        <Logo />
        {failed ? (
          <>
            <h1>Link expired</h1>
            <p className="lede" style={{ margin: 0 }}>This link has expired or was already used. Ask an admin to resend your invite, or use Forgotten password on the sign-in page.</p>
            <a className="btn blue" href="/login">Go to sign in</a>
          </>
        ) : (
          <p className="lede" style={{ margin: 0 }}>Checking your link…</p>
        )}
      </div>
    </main>
  );
}
