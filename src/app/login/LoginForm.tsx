'use client';
/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/browser';

type Step = 'creds' | 'enrol' | 'verify' | 'reset-sent';

export function LoginForm({ startAt2fa, accessError }: { startAt2fa: boolean; accessError: boolean }) {
  const supabase = createClient();
  const router = useRouter();
  const [step, setStep] = useState<Step>('creds');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [factorId, setFactorId] = useState('');
  const [qr, setQr] = useState('');
  const [secret, setSecret] = useState('');
  const [err, setErr] = useState(accessError ? 'Your account has been switched off. Speak to an admin.' : '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (accessError) supabase.auth.signOut();
    else if (startAt2fa) supabase.auth.getUser().then(({ data }) => data.user && startSecondFactor());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startSecondFactor() {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) return setErr(error.message);
    const verified = data.totp.find((f) => f.status === 'verified');
    if (verified) {
      setFactorId(verified.id);
      setStep('verify');
      return;
    }
    // First sign-in: set up an authenticator app. Clear any half-finished set-up first.
    for (const f of data.all.filter((f) => f.status !== 'verified')) await supabase.auth.mfa.unenroll({ factorId: f.id });
    const en = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'ShiftReady' });
    if (en.error) return setErr(en.error.message);
    setFactorId(en.data.id);
    setQr(en.data.totp.qr_code);
    setSecret(en.data.totp.secret);
    setStep('enrol');
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (!email || !password) return setErr('Enter your work email and password.');
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setBusy(false);
      return setErr('That email and password don’t match an account. Check them, or use “Forgotten password”.');
    }
    await startSecondFactor();
    setBusy(false);
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (!/^\d{6}$/.test(code.trim())) return setErr('Enter the 6-digit code from your authenticator app.');
    setBusy(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    if (error) {
      setBusy(false);
      return setErr('That code didn’t work. Codes change every 30 seconds, so try the current one.');
    }
    router.replace('/temps');
    router.refresh();
  }

  async function forgot() {
    setErr('');
    if (!email) return setErr('Type your work email above first, then press Forgotten password.');
    await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/auth/confirm` });
    setStep('reset-sent');
  }

  if (step === 'reset-sent')
    return (
      <div>
        <h1>Check your email</h1>
        <p className="lede">If {email} has a ShiftReady account, we’ve sent a link to set a new password.</p>
        <button className="btn ghost" onClick={() => setStep('creds')}>Back to sign in</button>
      </div>
    );

  if (step === 'enrol')
    return (
      <form onSubmit={verify}>
        <h1>Set up two-step sign-in</h1>
        <p className="lede" style={{ margin: 0 }}>
          Open an authenticator app on your phone (Google Authenticator, Microsoft Authenticator or similar), tap add, and scan this code.
        </p>
        <div className="qr"><img src={qr} alt="QR code for your authenticator app" /></div>
        <p className="note" style={{ margin: 0 }}>Can’t scan? Enter this key instead: <span className="mono">{secret}</span></p>
        <div className="f"><label className="l" htmlFor="code">6-digit code from the app</label>
          <input id="code" type="text" className="code" inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></div>
        {err && <p className="err">{err}</p>}
        <button className="btn blue" disabled={busy}>Verify and continue</button>
      </form>
    );

  if (step === 'verify')
    return (
      <form onSubmit={verify}>
        <h1>Enter your code</h1>
        <p className="lede" style={{ margin: 0 }}>Open your authenticator app and enter the 6-digit ShiftReady code.</p>
        <div className="f"><label className="l" htmlFor="code">6-digit code</label>
          <input id="code" type="text" className="code" inputMode="numeric" maxLength={6} autoComplete="one-time-code" autoFocus value={code} onChange={(e) => setCode(e.target.value)} /></div>
        {err && <p className="err">{err}</p>}
        <button className="btn blue" disabled={busy}>Verify and continue</button>
        <button type="button" className="btn ghost" onClick={async () => { await supabase.auth.signOut(); setStep('creds'); setCode(''); }}>Use a different account</button>
      </form>
    );

  return (
    <form onSubmit={signIn} noValidate>
      <h1>Consultant sign in</h1>
      <div className="f"><label className="l" htmlFor="email">Work email</label>
        <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div className="f"><label className="l" htmlFor="password">Password</label>
        <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
      {err && <p className="err">{err}</p>}
      <button className="btn blue" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      <button type="button" className="btn ghost" onClick={forgot}>Forgotten password</button>
    </form>
  );
}
