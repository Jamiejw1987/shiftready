'use client';
import { useState, useTransition } from 'react';
import { saveCheckCode } from './actions';

/** On a driver's own page: add a new DVLA check code so the office can check their licence. */
export function LicenceCode({ token, startOpen }: { token: string; startOpen: boolean }) {
  const [pending, start] = useTransition();
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  return (
    <div className="card" id="licence"><div className="in">
      <h3 style={{ margin: 0 }}>Driving licence check code</h3>
      {done ? <p style={{ margin: 0 }}>✓ Thanks, we’ve got your code and will check your licence.</p> : (
        <>
          <p style={{ margin: 0 }}>Get a code free at <a href="https://www.gov.uk/view-driving-licence" target="_blank" rel="noopener noreferrer">gov.uk/view-driving-licence</a>: sign in, choose “Share your licence information”, then “Create code”. Type it here exactly, capitals and small letters matter.</p>
          <div className="f"><label className="l" htmlFor="lcc">Check code</label>
            <input id="lcc" type="text" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="8 characters" value={code} onChange={(e) => setCode(e.target.value)} autoFocus={startOpen} /></div>
          {err && <p className="err" style={{ margin: 0 }}>{err}</p>}
          <button className="btn blue" disabled={pending || !code.trim()} onClick={() => start(async () => {
            setErr('');
            const r = await saveCheckCode(token, code);
            if (r.ok) setDone(true); else setErr(r.error!);
          })}>{pending ? 'Sending…' : 'Send code'}</button>
        </>
      )}
    </div></div>
  );
}
