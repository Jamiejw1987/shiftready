'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { publishDoc } from './actions';
import type { DocKind } from '@/lib/docs';

export function DocEditor({ kind, title: t0, body: b0 }: { kind: DocKind; title: string; body: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(!b0);
  const [title, setTitle] = useState(t0);
  const [body, setBody] = useState(b0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!editing)
    return (
      <>
        <details><summary>Read current wording</summary><div className="docbox" style={{ maxHeight: 480 }}>{b0}</div></details>
        <div className="btnrow" style={{ marginTop: 12 }}><button className="btn ghost" onClick={() => setEditing(true)}>Edit</button></div>
        {msg && <p className={msg.ok ? 'okmsg' : 'err'} style={{ marginTop: 10 }}>{msg.text}</p>}
      </>
    );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="f"><label className="l" htmlFor={`t-${kind}`}>Title</label><input id={`t-${kind}`} type="text" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      <div className="f"><label className="l" htmlFor={`b-${kind}`}>Wording</label><textarea id={`b-${kind}`} value={body} onChange={(e) => setBody(e.target.value)} style={{ minHeight: 420, fontSize: 14 }} /></div>
      {msg && <p className={msg.ok ? 'okmsg' : 'err'}>{msg.text}</p>}
      <div className="btnrow" style={{ justifyContent: 'flex-end' }}>
        {b0 && <button className="btn ghost" onClick={() => { setEditing(false); setTitle(t0); setBody(b0); setMsg(null); }}>Cancel</button>}
        <button className="btn blue" disabled={pending} onClick={() => start(async () => {
          const r = await publishDoc(kind, title, body);
          setMsg({ ok: r.ok, text: r.ok ? r.message! : r.error! });
          if (r.ok) { setEditing(false); router.refresh(); }
        })}>Save new version</button>
      </div>
    </div>
  );
}
