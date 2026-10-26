'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { sendRegistrationLink, resendRegistration, bulkInvite } from './actions';
import { parseApplicants, type Applicant } from './applicants';
import { displayMobile } from '@/lib/phone';

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

export function BulkInvite({ disabled, known }: { disabled: boolean; known: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState('');
  const [rows, setRows] = useState<(Applicant & { issue: string })[] | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function check(src: string) {
    setMsg(null);
    const have = new Set(known), seen = new Set<string>();
    const list = parseApplicants(src).filter((r) => r.first || r.mobile).map((r) => {
      let issue = '';
      if (!r.first) issue = 'No name';
      else if (!r.e164) issue = 'Not a UK mobile';
      else if (have.has(r.e164)) issue = 'Already on ShiftReady';
      else if (seen.has(r.e164)) issue = 'Duplicate';
      if (r.e164) seen.add(r.e164);
      return { ...r, issue };
    });
    setRows(list);
    if (!list.length) setMsg({ ok: false, text: 'Couldn’t find any names and mobiles. Use one person per line, like: Dan Smith, 07700 900123' });
  }
  function loadFile(f: File) { const r = new FileReader(); r.onload = () => { setText(String(r.result)); check(String(r.result)); }; r.readAsText(f); }
  const good = (rows ?? []).filter((r) => !r.issue);

  function send() {
    start(async () => {
      const r = await bulkInvite(good.map(({ first, last, mobile }) => ({ first, last, mobile })), confirmed);
      setMsg({ ok: r.ok, text: r.ok ? r.message! : r.error! });
      if (r.ok) { setRows(null); setText(''); setConfirmed(false); router.refresh(); }
    });
  }

  return (
    <>
      <div className="f">
        <label className="l" htmlFor="bulkText">Paste names and mobiles, one person per line</label>
        <textarea id="bulkText" placeholder={'Dan Smith, 07700 900123\nAmy Jones, 07700 900456'} value={text} onChange={(e) => { setText(e.target.value); setRows(null); }} style={{ minHeight: 120 }} />
      </div>
      <div className="btnrow" style={{ marginTop: 10 }}>
        <button className="btn ghost" disabled={!text.trim()} onClick={() => check(text)}>Check list</button>
        <label className="btn ghost" htmlFor="bulkFile">Or upload a CSV</label>
        <input id="bulkFile" type="file" accept=".csv,text/csv,text/plain" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ''; }} />
        <span className="note">An Indeed or job board export works if it has name and phone columns.</span>
      </div>
      {rows && rows.length > 0 && (
        <>
          <div className="summary"><span className="pill ok">{good.length} ready</span>{rows.length - good.length > 0 && <span className="pill bad">{rows.length - good.length} will be skipped</span>}</div>
          <div className="tablewrap" style={{ maxHeight: 320, overflowY: 'auto' }}><table className="cards"><thead><tr><th>Name</th><th>Mobile</th><th>Check</th></tr></thead><tbody>
            {rows.map((r, i) => (
              <tr key={i} className={r.issue ? 'bad' : ''}>
                <td><b>{r.first} {r.last}</b></td>
                <td className="num" data-l="Mobile">{r.e164 ? displayMobile(r.e164) : r.mobile || '-'}</td>
                <td>{r.issue ? <span className="err">{r.issue}</span> : <span className="pill ok">OK</span>}</td>
              </tr>))}
          </tbody></table></div>
          <label className="tick" style={{ marginTop: 12 }}>
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            Everyone on this list applied to one of our roles or asked us about work. (We can’t text bought lists, scraped numbers or people who’ve opted out.)
          </label>
          <div className="bar">
            <span className="note">Each person gets their own registration link. Every text says “Reply STOP to opt out”.</span>
            <button className="btn blue" disabled={disabled || !good.length || !confirmed || pending} onClick={send}>{pending ? 'Sending…' : `Send ${good.length} registration link${good.length === 1 ? '' : 's'}`}</button>
          </div>
        </>
      )}
      {msg && <p className={msg.ok ? 'okmsg' : 'err'} style={{ marginTop: 10 }}>{msg.text}</p>}
    </>
  );
}
