'use client';
import { useState, useTransition } from 'react';
import { joinUp } from './actions';

export function JoinForm({ from }: { from: string }) {
  const [pending, start] = useTransition();
  const [f, setF] = useState({ first: '', last: '', mobile: '', consent: false, website: '' });
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  if (done) return (
    <div className="state">
      <div className="badge ok">✓</div>
      <div className="big">Check your texts</div>
      <p>We’ve sent your personal registration link to {f.mobile}. It takes about 10 minutes to fill in. Have your share code or passport ready.</p>
      <p className="note">No text after a few minutes? Check the number and try again, or call the office.</p>
    </div>
  );

  return (
    <div className="card"><div className="in">
      <h2 className="sech">Register for temporary work</h2>
      <p style={{ margin: 0 }}>Join Staff Selection UK to hear about jobs and shifts near you. Enter your details and we’ll text you a link to register.</p>
      <div className="form">
        <div className="f"><label className="l" htmlFor="jf">First name</label><input id="jf" type="text" autoComplete="given-name" value={f.first} onChange={(e) => setF({ ...f, first: e.target.value })} /></div>
        <div className="f"><label className="l" htmlFor="jl">Surname</label><input id="jl" type="text" autoComplete="family-name" value={f.last} onChange={(e) => setF({ ...f, last: e.target.value })} /></div>
        <div className="f w4"><label className="l" htmlFor="jm">Mobile</label><input id="jm" type="tel" autoComplete="tel" placeholder="07…" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} /></div>
      </div>
      {/* Hidden from people; bots fill it in. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} style={{ position: 'absolute', left: '-9999px' }} aria-hidden="true" />
      <label className="tick"><input type="checkbox" checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} /> Text me my registration link. Staff Selection UK will use my details to contact me about work.</label>
      {err && <p className="err">{err}</p>}
      <button className="btn blue" style={{ minHeight: 52 }} disabled={pending} onClick={() => { setErr(''); start(async () => {
        const r = await joinUp({ ...f, from });
        if (!r.ok) return setErr(r.error ?? 'Something went wrong.');
        setDone(true);
      }); }}>{pending ? 'Sending…' : 'Text me my registration link'}</button>
      <p className="note" style={{ margin: 0 }}>Already registered? Text HOLIDAY or P45 to our number any time, or ask the office for your link.</p>
    </div></div>
  );
}
