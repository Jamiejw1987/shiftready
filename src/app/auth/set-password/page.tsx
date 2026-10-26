'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/browser';
import { Logo } from '@/components/Logo';

export default function SetPassword() {
  const supabase = createClient();
  const router = useRouter();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (pw.length < 12) return setErr('Use at least 12 characters.');
    if (pw !== pw2) return setErr('The two passwords don’t match.');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setErr(error.message.includes('session') ? 'This link has expired. Ask an admin to resend your invite.' : error.message);
    router.replace('/login?step=2fa');
  }

  return (
    <main className="center">
      <div className="lcard">
        <Logo />
        <form onSubmit={save} noValidate>
          <h1>Set your password</h1>
          <p className="lede" style={{ margin: 0 }}>At least 12 characters. A short phrase is easiest to remember.</p>
          <div className="f"><label className="l" htmlFor="pw">New password</label>
            <input id="pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
          <div className="f"><label className="l" htmlFor="pw2">Type it again</label>
            <input id="pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>
          {err && <p className="err">{err}</p>}
          <button className="btn blue" disabled={busy}>Save and continue</button>
        </form>
      </div>
    </main>
  );
}
