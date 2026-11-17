'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { uploadToSlot } from '@/lib/upload';
import { pdfToImages } from '@/lib/pdfPages';
import {
  savePack, setPackActive, docUploadSlots, registerDoc, updateDoc, moveDoc, removeDoc,
  createSupervisor, resetSupervisorPassword, setSupervisorActive, type PackInput,
} from './actions';

type Msg = { ok: boolean; text: string } | null;
const Note = ({ m }: { m: Msg }) => (m ? <p className={m.ok ? 'okmsg' : 'err'} style={{ marginTop: 10 }}>{m.text}</p> : null);
type Opt = { id: string; name: string };

export function PackForm({ clients, pack }: { clients: Opt[]; pack?: { id: string; active: boolean } & PackInput }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const [f, setF] = useState<PackInput>(pack ?? { name: '', clientId: '', site: '', scope: 'Warehouse Operative', arrival: '', agency: 'Staff Selection UK Ltd' });
  const set = (k: keyof PackInput, v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <div className="form">
      <div className="pgrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <div className="f"><label className="l" htmlFor="pn">Pack name <span className="note">temps see this</span></label><input id="pn" value={f.name} placeholder="DHL / EVRi agency induction" onChange={(e) => set('name', e.target.value)} /></div>
        <div className="f"><label className="l" htmlFor="pc">Client</label>
          <select id="pc" value={f.clientId} onChange={(e) => set('clientId', e.target.value)}>
            <option value="">Any client</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></div>
        <div className="f"><label className="l" htmlFor="ps">Site <span className="note">printed on the form</span></label><input id="ps" value={f.site} placeholder="Coventry Hub" onChange={(e) => set('site', e.target.value)} /></div>
        <div className="f"><label className="l" htmlFor="pw">Scope of work</label><input id="pw" value={f.scope} onChange={(e) => set('scope', e.target.value)} /></div>
        <div className="f"><label className="l" htmlFor="pa">Usual arrival time</label><input id="pa" value={f.arrival} placeholder="06:00" onChange={(e) => set('arrival', e.target.value)} /></div>
        <div className="f"><label className="l" htmlFor="pg">Agency provider</label><input id="pg" value={f.agency} onChange={(e) => set('agency', e.target.value)} /></div>
      </div>
      <div className="btnrow" style={{ marginTop: 12 }}>
        <button className="btn blue" disabled={pending} onClick={() => start(async () => {
          const r = await savePack(pack?.id ?? null, f);
          setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Saved.' : r.error ?? 'Something went wrong.' });
          if (r.ok && !pack && r.id) router.push(`/team/inductions/${r.id}`); else router.refresh();
        })}>{pack ? 'Save details' : 'Create pack'}</button>
        {pack && <button className="btn ghost" disabled={pending} onClick={() => start(async () => {
          const r = await setPackActive(pack.id, !pack.active); setMsg({ ok: r.ok, text: r.message ?? '' }); router.refresh();
        })}>{pack.active ? 'Switch off' : 'Switch on'}</button>}
      </div>
      <Note m={msg} />
    </div>
  );
}

/** Adds the client's PDFs, in name order. Each page is turned into a picture here, then everything is uploaded. */
export function DocUploader({ packId }: { packId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [log, setLog] = useState<Msg[]>([]);
  const add = async (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (!files.length) { setLog([{ ok: false, text: 'Choose PDF files.' }]); return; }
    setBusy(true); setLog([]);
    for (const [i, f] of files.entries()) {
      const title = f.name.replace(/\.pdf$/i, '').replace(/^\d+[\s._-]+/, '').replace(/\s+/g, ' ').trim();
      try {
        setStage(`${i + 1} of ${files.length}: drawing pages of ${title}`);
        const pics = await pdfToImages(f, (n, t) => setStage(`${i + 1} of ${files.length}: drawing page ${n} of ${t} of ${title}`));
        const s = await docUploadSlots(packId, pics.length, f.size);
        if (!s.ok) throw new Error(s.error);
        setStage(`${i + 1} of ${files.length}: uploading ${title}`);
        if (!(await uploadToSlot(s.pdf.path, s.pdf.token, f, 'application/pdf'))) throw new Error('Upload failed.');
        for (const [k, img] of s.images.entries()) if (!(await uploadToSlot(img.path, img.token, pics[k], 'image/jpeg'))) throw new Error('Upload failed.');
        const r = await registerDoc(packId, s.docId, title, pics.length);
        setLog((l) => [...l, { ok: r.ok, text: `${title}: ${r.ok ? r.message ?? 'Added.' : r.error}` }]);
      } catch (e) {
        setLog((l) => [...l, { ok: false, text: `${title}: ${(e as Error).message || 'failed'}` }]);
      }
    }
    setBusy(false); setStage(''); router.refresh();
  };
  return (
    <div>
      <label className="btn blue" style={{ cursor: busy ? 'wait' : 'pointer' }} aria-disabled={busy}>
        {busy ? 'Adding…' : 'Add PDFs'}
        <input type="file" accept="application/pdf,.pdf" multiple hidden disabled={busy} onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
      </label>
      <p className="note" style={{ margin: '8px 0 0' }}>Choose several at once. They’re added in file-name order (number them 01, 02… to set the order) and can be moved after. Keep this page open until it finishes.</p>
      {stage && <p className="note" style={{ fontWeight: 700 }}>{stage}</p>}
      {log.map((m, i) => <Note key={i} m={m} />)}
    </div>
  );
}

export type DocRowData = { id: string; title: string; page_count: number; in_app: boolean; sign_mode: 'document' | 'every_page'; site_pages: number[]; hidden_pages: number[]; template: string | null; templateLabel: string | null; preview: string | null };

export function DocRow({ d, first, last }: { d: DocRowData; first: boolean; last: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [f, setF] = useState({ title: d.title, inApp: d.in_app, signMode: d.sign_mode, sitePages: d.site_pages.join(', '), hiddenPages: d.hidden_pages.join(', ') });
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    start(async () => { const r = await fn(); setMsg(r.message || r.error ? { ok: r.ok, text: r.ok ? r.message ?? '' : r.error ?? '' } : null); router.refresh(); });
  return (
    <tr>
      <td>
        <b>{d.title}</b> <span className="note">· {d.page_count} page{d.page_count === 1 ? '' : 's'}</span>
        <div className="btnrow" style={{ marginTop: 4 }}>
          {d.in_app ? <span className="pill blue">{d.sign_mode === 'every_page' ? 'Read, tick and initial every page' : 'Read and tick every page, sign at the end'}</span> : <span className="pill mute">Not read in the app</span>}
          {d.in_app && d.hidden_pages.length > 0 && <span className="pill mute">Hidden from temps: page{d.hidden_pages.length === 1 ? '' : 's'} {d.hidden_pages.join(', ')}</span>}
          {d.site_pages.length > 0 && <span className="pill warn">Day one on paper: page{d.site_pages.length === 1 ? '' : 's'} {d.site_pages.join(', ')}</span>}
          {d.templateLabel && <span className="pill ok">Details printed on it</span>}
        </div>
        {open && (
          <div className="form" style={{ marginTop: 10 }}>
            <div className="f"><label className="l">Title</label><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
            <label className="tick"><input type="checkbox" checked={f.inApp} onChange={(e) => setF({ ...f, inApp: e.target.checked })} /> Temps read it and sign it in the app</label>
            {f.inApp && <div className="f"><label className="l">Signing</label>
              <select value={f.signMode} onChange={(e) => setF({ ...f, signMode: e.target.value as 'document' | 'every_page' })}>
                <option value="document">Tick every page, sign once at the end</option>
                <option value="every_page">Tick and initial every page</option>
              </select></div>}
            {f.inApp && <div className="f"><label className="l">Pages temps don’t see <span className="note">e.g. the blank group sign-in sheet. Blank = show every page</span></label>
              <input value={f.hiddenPages} onChange={(e) => setF({ ...f, hiddenPages: e.target.value })} /></div>}
            <div className="f"><label className="l">Pages printed for the day-one paper sign-off <span className="note">e.g. 1, 8 or all. Blank = none</span></label>
              <input value={f.sitePages} onChange={(e) => setF({ ...f, sitePages: e.target.value })} /></div>
            <div className="btnrow">
              <button className="btn blue small" disabled={pending} onClick={() => run(() => updateDoc(d.id, f))}>Save</button>
              <button className="btn ghost small danger" disabled={pending} onClick={() => { if (confirm(`Take “${d.title}” out of the pack? Inductions already sent keep it.`)) run(() => removeDoc(d.id)); }}>Remove from pack</button>
            </div>
          </div>
        )}
        <Note m={msg} />
      </td>
      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
        {d.preview && <a className="btn ghost small" href={d.preview} target="_blank" rel="noopener noreferrer">Page 1</a>}{' '}
        <button className="btn ghost small" aria-label="Move up" disabled={pending || first} onClick={() => run(() => moveDoc(d.id, -1))}>↑</button>{' '}
        <button className="btn ghost small" aria-label="Move down" disabled={pending || last} onClick={() => run(() => moveDoc(d.id, 1))}>↓</button>{' '}
        <button className="btn ghost small" onClick={() => setOpen(!open)}>{open ? 'Close' : 'Settings'}</button>
      </td>
    </tr>
  );
}

type Sup = { id: string; username: string; full_name: string; active: boolean; last_login_at: string | null; client: string | null };
export function Supervisors({ list, clients }: { list: Sup[]; clients: Opt[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const [f, setF] = useState({ username: '', fullName: '', password: '', clientId: '' });
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) =>
    start(async () => { const r = await fn(); setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Done.' : r.error ?? 'Something went wrong.' }); if (r.ok) after?.(); router.refresh(); });
  return (
    <>
      <div className="tablewrap" style={{ marginBottom: 14 }}><table>
        <tbody>
          {list.map((s) => (
            <tr key={s.id}>
              <td><b>{s.full_name}</b> <span className="mono">{s.username}</span><br />
                <span className="note">{s.client ?? 'All clients'} · {s.last_login_at ? `last signed in ${new Date(s.last_login_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}` : 'never signed in'}</span></td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                {!s.active && <span className="pill mute">Off</span>}{' '}
                <button className="btn ghost small" disabled={pending} onClick={() => {
                  const pw = prompt(`New password for ${s.full_name} (at least 10 characters):`);
                  if (pw) run(() => resetSupervisorPassword(s.id, pw));
                }}>New password</button>{' '}
                <button className="btn ghost small" disabled={pending} onClick={() => run(() => setSupervisorActive(s.id, !s.active))}>{s.active ? 'Switch off' : 'Switch on'}</button>
              </td>
            </tr>
          ))}
          {!list.length && <tr><td className="note">No site logins yet.</td></tr>}
        </tbody>
      </table></div>
      <h3>Add a site login</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <div className="f"><label className="l" htmlFor="sn">Their name</label><input id="sn" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></div>
        <div className="f"><label className="l" htmlFor="su">Username</label><input id="su" autoCapitalize="none" value={f.username} placeholder="dhl.coventry" onChange={(e) => setF({ ...f, username: e.target.value })} /></div>
        <div className="f"><label className="l" htmlFor="sp">Password <span className="note">10+ characters</span></label><input id="sp" type="text" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
        <div className="f"><label className="l" htmlFor="sc">Only for</label>
          <select id="sc" value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })}>
            <option value="">All clients</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></div>
      </div>
      <div className="btnrow" style={{ marginTop: 12 }}>
        <button className="btn blue" disabled={pending} onClick={() => run(() => createSupervisor(f), () => setF({ username: '', fullName: '', password: '', clientId: '' }))}>Create login</button>
      </div>
      <Note m={msg} />
    </>
  );
}
