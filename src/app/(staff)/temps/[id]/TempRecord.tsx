'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { prepareFile, uploadToSlot, OK_TYPES } from '@/lib/upload';
import { resendRegistration } from '../../registrations/actions';
import { approve, messageTemp, recordRtwCheck, recordStaffUpload, reveal, sendBankLink, staffUploadSlot, clearBank } from './actions';

type Msg = { ok: boolean; text: string } | null;
const Note = ({ m }: { m: Msg }) => (m ? <p className={m.ok ? 'okmsg' : 'err'} style={{ marginTop: 10 }}>{m.text}</p> : null);

export function RecordActions({ id, firstName, status, registered, canApprove, approveBlock }: {
  id: string; firstName: string; status: string; registered: boolean; canApprove: boolean; approveBlock: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const [compose, setCompose] = useState(false);
  const [body, setBody] = useState('');
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) =>
    start(async () => { const r = await fn(); setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Done.' : r.error ?? 'Something went wrong.' }); if (r.ok) after?.(); router.refresh(); });

  return (
    <>
      <div className="bar">
        <span className="note">{approveBlock}</span>
        <div className="btnrow">
          {!registered && status !== 'out' && <button className="btn ghost" disabled={pending} onClick={() => run(() => resendRegistration(id))}>{status === 'invited' ? 'Resend registration link' : 'Send registration form'}</button>}
          {status !== 'out' && <button className="btn ghost" onClick={() => { setCompose(!compose); setMsg(null); }}>Text {firstName}</button>}
          {status === 'review' && <button className="btn blue" disabled={!canApprove || pending} onClick={() => run(() => approve(id))}>Approve</button>}
        </div>
      </div>
      {compose && (
        <div className="compose" style={{ marginTop: 12, marginBottom: 0 }}>
          <div className="f"><label className="l" htmlFor="tmsg">Message <span className="note">e.g. ask for a clearer passport photo or a new share code</span></label>
            <textarea id="tmsg" value={body} onChange={(e) => setBody(e.target.value)} /></div>
          <div className="btnrow" style={{ justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={() => setCompose(false)}>Cancel</button>
            <button className="btn blue" disabled={pending || !body.trim()} onClick={() => run(() => messageTemp(id, body), () => { setBody(''); setCompose(false); })}>Send</button>
          </div>
        </div>
      )}
      <Note m={msg} />
    </>
  );
}

export function RtwCheck({ id, route: initial, shareCode, dob, recheck }: { id: string; route: 'share_code' | 'british_irish'; shareCode: string | null; dob: string | null; recheck: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(!recheck);
  const [route, setRoute] = useState(initial);
  const [expires, setExpires] = useState('');
  const [noLimit, setNoLimit] = useState(false);
  const [seen, setSeen] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [copied, setCopied] = useState('');
  const dobText = dob ? new Date(dob + 'T12:00:00Z').toLocaleDateString('en-GB') : '';
  const copy = (label: string, v: string) => { navigator.clipboard?.writeText(v).then(() => setCopied(label)).catch(() => {}); };

  if (!open) return <button className="btn ghost" onClick={() => setOpen(true)}>Record a new check</button>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="chips">
        <label className="chip"><input type="radio" name="route" checked={route === 'share_code'} onChange={() => setRoute('share_code')} /> Share code</label>
        <label className="chip"><input type="radio" name="route" checked={route === 'british_irish'} onChange={() => setRoute('british_irish')} /> British or Irish passport</label>
      </div>
      {route === 'share_code' ? (
        <>
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <li>Open the GOV.UK checker: <a className="btn blue small" href="https://www.gov.uk/view-right-to-work" target="_blank" rel="noopener noreferrer">Open GOV.UK check</a></li>
            <li>Enter the share code <b className="mono">{shareCode ?? 'not given'}</b>{shareCode && <> <button className="btn ghost small" onClick={() => copy('code', shareCode)}>{copied === 'code' ? 'Copied' : 'Copy'}</button></>} and date of birth <b>{dobText || 'not given'}</b>.</li>
            <li>Check the photo matches the person, and that they’re allowed to do this work.</li>
            <li>Download the result page as a PDF (or screenshot it) and upload it below as “Right to work check result”.</li>
          </ol>
          <div className="form">
            <div className="f w2"><label className="l" htmlFor="rexp">Permission to work ends</label><input id="rexp" type="date" value={expires} disabled={noLimit} onChange={(e) => setExpires(e.target.value)} /></div>
            <div className="f w2" style={{ justifyContent: 'flex-end' }}><label className="chip"><input type="checkbox" checked={noLimit} onChange={(e) => setNoLimit(e.target.checked)} /> No time limit (e.g. settled status)</label></div>
          </div>
        </>
      ) : (
        <>
          <p className="note" style={{ margin: 0 }}>Check the original passport in person or on a live video call, make sure the photo matches, and keep a copy (their uploaded photo counts if it’s clear, or upload your own below).</p>
          <label className="tick"><input type="checkbox" checked={seen} onChange={(e) => setSeen(e.target.checked)} /> I’ve seen the original passport and it matches this person</label>
        </>
      )}
      <div className="btnrow">
        {recheck && <button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>}
        <button className="btn blue" disabled={pending} onClick={() => start(async () => {
          const r = await recordRtwCheck(id, { route, expires, noLimit, seenOriginal: seen });
          setMsg({ ok: r.ok, text: r.ok ? r.message! : r.error! });
          if (r.ok) { setOpen(false); router.refresh(); }
        })}>Save right to work check</button>
      </div>
      <Note m={msg} />
    </div>
  );
}

export function Uploader({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [kind, setKind] = useState('rtw_check');
  const [msg, setMsg] = useState<Msg>(null);
  function upload(f: File | undefined) {
    setMsg(null);
    if (!f) return;
    if (f.type && !OK_TYPES.includes(f.type)) return setMsg({ ok: false, text: 'Upload a photo (JPEG or PNG) or a PDF.' });
    start(async () => {
      const x = await prepareFile(f);
      const s = await staffUploadSlot(id, kind, x.type, x.blob.size);
      if (!s.ok) return setMsg({ ok: false, text: s.error });
      if (!(await uploadToSlot(s.slots[0].path, s.slots[0].token, x.blob, x.type))) return setMsg({ ok: false, text: 'Upload failed. Try again.' });
      const r = await recordStaffUpload(id, kind, s.slots[0].path, x.name);
      setMsg({ ok: r.ok, text: r.ok ? 'Uploaded.' : r.error! });
      router.refresh();
    });
  }
  return (
    <>
      <div className="btnrow">
        <select aria-label="Document type" value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: 'auto' }}>
          <option value="rtw_check">Right to work check result</option><option value="passport">Passport</option><option value="id">Photo ID</option><option value="ni_proof">Proof of NI number</option>
          <option value="flt_licence">FLT licence</option><option value="other">Other</option>
        </select>
        <label className="btn" htmlFor="staffFile">{pending ? 'Uploading…' : 'Upload'}</label>
        <input id="staffFile" type="file" accept="image/*,application/pdf" hidden disabled={pending} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      <Note m={msg} />
    </>
  );
}

export function Reveal({ id, field }: { id: string; field: 'ni' | 'health' | 'convictions' | 'bank' }) {
  const [pending, start] = useTransition();
  const [value, setValue] = useState<string | null>(null);
  const [err, setErr] = useState('');
  if (value != null) return <div className="secret">{value} <button className="btn ghost small" onClick={() => setValue(null)}>Hide</button></div>;
  return (
    <>
      <button className="btn ghost small" disabled={pending} onClick={() => start(async () => { const r = await reveal(id, field); if (r.ok) setValue(r.value!); else setErr(r.error!); })}>Show</button>
      {err && <span className="err"> {err}</span>}
    </>
  );
}

export function BankActions({ id, onFile, admin }: { id: string; onFile: boolean; admin: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const [confirm, setConfirm] = useState(false);
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    start(async () => { const r = await fn(); setMsg({ ok: r.ok, text: r.ok ? r.message! : r.error! }); setConfirm(false); router.refresh(); });
  return (
    <>
      <div className="btnrow" style={{ marginTop: 14 }}>
        {!onFile && <button className="btn ghost small" disabled={pending} onClick={() => run(() => sendBankLink(id))}>Text bank details link</button>}
        {onFile && admin && (confirm
          ? <><button className="btn small" style={{ background: 'var(--bad)' }} disabled={pending} onClick={() => run(() => clearBank(id))}>Confirm clear</button><button className="btn ghost small" onClick={() => setConfirm(false)}>Keep</button></>
          : <button className="btn ghost small" onClick={() => setConfirm(true)}>Clear bank details</button>)}
      </div>
      <Note m={msg} />
    </>
  );
}
