'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveBank } from './actions';

export function BankForm({ token, first }: { token: string; first: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [b, setB] = useState({ name: '', sortCode: '', account: '', account2: '' });
  const [err, setErr] = useState('');
  const set = (k: keyof typeof b, v: string) => setB((x) => ({ ...x, [k]: v }));

  function save() {
    setErr('');
    start(async () => {
      const r = await saveBank(token, b);
      if (!r.ok) return setErr(r.error ?? 'Something went wrong.');
      router.refresh();
    });
  }

  return (
    <div className="card"><div className="in">
      <h2 className="sech">Bank details</h2>
      <p style={{ margin: 0 }}>Hi {first}. Add the account you’d like to be paid into. Your details are encrypted and only our payroll admins can see them.</p>
      <div className="f"><label className="l" htmlFor="bn">Name on the account</label><input id="bn" type="text" autoComplete="cc-name" value={b.name} onChange={(e) => set('name', e.target.value)} /></div>
      <div className="f"><label className="l" htmlFor="bs">Sort code</label><input id="bs" type="text" inputMode="numeric" placeholder="12-34-56" value={b.sortCode} onChange={(e) => set('sortCode', e.target.value)} /></div>
      <div className="f"><label className="l" htmlFor="ba">Account number</label><input id="ba" type="text" inputMode="numeric" placeholder="8 numbers" value={b.account} onChange={(e) => set('account', e.target.value)} /></div>
      <div className="f"><label className="l" htmlFor="ba2">Account number again</label><input id="ba2" type="text" inputMode="numeric" autoComplete="off" value={b.account2} onChange={(e) => set('account2', e.target.value)} onPaste={(e) => e.preventDefault()} /></div>
      {err && <p className="err">{err}</p>}
      <button className="btn blue" style={{ minHeight: 52 }} disabled={pending} onClick={save}>{pending ? 'Saving…' : 'Save bank details'}</button>
      <p className="note" style={{ margin: 0 }}>We will never ask for your PIN, card number or online banking password.</p>
    </div></div>
  );
}
