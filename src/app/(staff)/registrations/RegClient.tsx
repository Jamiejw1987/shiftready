'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { sendRegistrationLink, resendRegistration } from './actions';

export function InviteForm({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [f, setF] = useState({ first: '', last: '', mobile: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  function send() {
    start(async () => {
      const r = await sendRegistrationLink(f);
      setMsg({ ok: r.ok, text: r.ok ? r.message! : r.error! });
      if (r.ok) { setF({ first: '', last: '', mobile: '' }); router.refresh(); }
    });
  }
  return (
    <>
      <div className="form">
        <div className="f"><label className="l" htmlFor="iFirst">First name</label><input id="iFirst" type="text" value={f.first} onChange={(e) => setF({ ...f, first: e.target.value })} /></div>
        <div className="f"><label className="l" htmlFor="iLast">Surname</label><input id="iLast" type="text" value={f.last} onChange={(e) => setF({ ...f, last: e.target.value })} /></div>
        <div className="f w2"><label className="l" htmlFor="iMob">Mobile</label><input id="iMob" type="tel" placeholder="07…" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} /></div>
      </div>
      <div className="bar">
        {msg ? <p className={msg.ok ? 'okmsg' : 'err'}>{msg.text}</p> : <span className="note">They’ll get a text with their personal link.</span>}
        <button className="btn blue" disabled={disabled || pending} onClick={send}>{pending ? 'Sending…' : 'Send registration link'}</button>
      </div>
    </>
  );
}

export function ResendButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState('');
  return (
    <>
      <button className="btn ghost small" disabled={pending} onClick={() => start(async () => { const r = await resendRegistration(id); setNote(r.ok ? 'Sent' : r.error!); router.refresh(); })}>Resend</button>
      {note && <span className="note">{note}</span>}
    </>
  );
}
