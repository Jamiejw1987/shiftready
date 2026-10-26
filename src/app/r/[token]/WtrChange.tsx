'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { changeWtr } from './actions';

export function WtrChange({ token, optedOut, effective, lastName }: { token: string; optedOut: boolean; effective: string | null; lastName: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [sig, setSig] = useState('');
  const [err, setErr] = useState('');
  const future = effective && effective > new Date().toISOString().slice(0, 10);

  function save() {
    setErr('');
    start(async () => {
      const r = await changeWtr(token, !optedOut, sig);
      if (!r.ok) return setErr(r.error ?? 'Something went wrong.');
      setOpen(false); setSig(''); router.refresh();
    });
  }

  return (
    <div className="card"><div className="in">
      <h3 style={{ margin: 0 }}>48-hour working week</h3>
      <p style={{ margin: 0 }}>
        {optedOut
          ? 'You’ve opted out of the 48-hour average weekly limit.'
          : future
            ? `You’ve cancelled your opt-out. The 48-hour limit applies again from ${new Date(effective + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}.`
            : 'The 48-hour average weekly limit applies to you.'}
      </p>
      {open ? (
        <>
          <p className="note" style={{ margin: 0 }}>{optedOut ? 'Cancelling your opt-out takes effect after 7 days’ notice.' : 'By opting out you agree the 48-hour average weekly limit won’t apply to you. You can cancel at any time with 7 days’ notice.'}</p>
          <div className="f"><label className="l" htmlFor="wtrSig">Type your full name to confirm</label>
            <input id="wtrSig" type="text" autoComplete="name" value={sig} onChange={(e) => setSig(e.target.value)} placeholder={`e.g. Sam ${lastName}`} /></div>
          {err && <p className="err">{err}</p>}
          <div className="actions"><button className="btn ghost" onClick={() => setOpen(false)}>Back</button>
            <button className="btn blue" disabled={pending} onClick={save}>{optedOut ? 'Cancel my opt-out' : 'Opt out'}</button></div>
        </>
      ) : (
        <button className="btn ghost" onClick={() => setOpen(true)}>{optedOut ? 'Cancel my opt-out' : 'Opt out of the 48-hour limit'}</button>
      )}
    </div></div>
  );
}
