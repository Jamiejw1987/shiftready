'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveApplyMessage, retryApplication } from './applyActions';
import { applyMessageProblems, DEFAULT_APPLY_MESSAGE } from '@/lib/applyMessage';
import { plainText, segmentInfo } from '@/lib/smsText';

export function ApplyAddress({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const [show, setShow] = useState(false);
  return (
    <div className="f"><span className="l">Address to give CV-Library (keep it private, it lets anyone add applicants)</span>
      <div className="btnrow">
        <span className="secret" style={{ flex: '1 1 260px', wordBreak: 'break-all' }}>{show ? url : url.replace(/key=.*/, 'key=••••••••••••')}</span>
        <button className="btn ghost" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
        <button className="btn ghost" onClick={() => navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {})}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
    </div>
  );
}

export function ApplyMessage({ current, base, canEdit }: { current: string; base: string; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState(current);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const preview = text.replace(/\{first\}/g, 'Sarah').replace(/\{job\}/g, 'Warehouse Operative').replace(/\{link\}/g, `${base}/r/00000000-0000-0000-0000-000000000000`).replace(/\s+/g, ' ').trim();
  const seg = segmentInfo(plainText(preview));
  const problems = applyMessageProblems(text);
  const save = () => start(async () => {
    const r = await saveApplyMessage(text);
    setMsg({ ok: r.ok, text: r.ok ? r.message! : r.error! });
    if (r.ok) router.refresh();
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label className="f"><span className="l">Text every applicant gets straight away</span>
        <textarea rows={4} value={text} disabled={!canEdit || pending} onChange={(e) => { setText(e.target.value); setMsg(null); }} /></label>
      <p className="note" style={{ margin: 0 }}>
        <b>{'{first}'}</b> = their first name, <b>{'{job}'}</b> = the job they applied for, <b>{'{link}'}</b> = their personal registration link.
        {canEdit ? '' : ' Only an admin can change it.'}
      </p>
      <div className="f"><span className="l">How it looks</span>
        <div className="secret" style={{ fontFamily: 'var(--f-body)', fontSize: 14 }}>{preview}</div>
        <span className="note">{seg.chars} characters, {seg.segments} text{seg.segments === 1 ? '' : 's'} each{seg.unicode ? ' (a special character makes each text shorter: check for curly quotes or emoji)' : ''}.</span></div>
      {canEdit && problems.length > 0 && text.trim() && <p className="alert" style={{ margin: 0 }}>{problems.join('. ')}.</p>}
      {msg && <p className={msg.ok ? 'okmsg' : 'err'} style={{ margin: 0 }}>{msg.text}</p>}
      {canEdit && (
        <div className="btnrow">
          <button className="btn blue" disabled={pending || problems.length > 0 || text.trim() === current.trim()} onClick={save}>{pending ? 'Saving…' : 'Save message'}</button>
          {text.trim() !== DEFAULT_APPLY_MESSAGE && <button className="btn ghost" disabled={pending} onClick={() => { setText(DEFAULT_APPLY_MESSAGE); setMsg(null); }}>Use the standard wording</button>}
        </div>
      )}
    </div>
  );
}

export function RetryButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState('');
  return (
    <>
      <button className="btn ghost small" disabled={pending} onClick={() => start(async () => { const r = await retryApplication(id); setErr(r.ok ? '' : r.error!); router.refresh(); })}>{pending ? 'Sending…' : 'Send link'}</button>
      {err && <span className="note" style={{ color: 'var(--bad, #b42318)' }}>{err}</span>}
    </>
  );
}
