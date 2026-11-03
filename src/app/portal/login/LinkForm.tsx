'use client';
import { useState, useTransition } from 'react';
import { requestLink } from '../actions';

export function LinkForm() {
  const [pending, start] = useTransition();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');

  if (sent)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h1>Check your email</h1>
        <p className="lede" style={{ margin: 0 }}>If {email} has access to ShiftReady, a sign-in link is on its way. It can take a minute. Check your junk folder too.</p>
        <button className="btn ghost" onClick={() => setSent(false)}>Use a different email</button>
      </div>
    );

  return (
    <form noValidate onSubmit={(e) => {
      e.preventDefault();
      setErr('');
      start(async () => {
        const r = await requestLink(email);
        if (!r.ok) setErr(r.error ?? 'Something went wrong.');
        else setSent(true);
      });
    }}>
      <h1>Client sign in</h1>
      <p className="lede" style={{ margin: 0 }}>Enter your work email and we’ll send you a link. No password needed.</p>
      <div className="f"><label className="l" htmlFor="email">Work email</label>
        <input id="email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      {err && <p className="err">{err}</p>}
      <button className="btn blue" disabled={pending}>{pending ? 'Sending…' : 'Email me a sign-in link'}</button>
      <p className="note" style={{ margin: 0 }}>Staff Selection consultant? <a href="/login">Sign in here</a>.</p>
    </form>
  );
}
