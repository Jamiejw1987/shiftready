'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClientAccount, updateClientAccount, saveSite, inviteClientUser, resendClientLink, removeClientUser, setUserSites, liftBlock } from './actions';

type Msg = { ok: boolean; text: string; link?: string | null } | null;
const Note = ({ m }: { m: Msg }) => (m ? <div className={m.ok ? 'okmsg' : 'err'} style={{ marginTop: 10 }}>{m.text}{m.link && <><br /><input readOnly value={m.link} onFocus={(e) => e.target.select()} style={{ marginTop: 6, width: '100%' }} /></>}</div> : null);

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string; link?: string | null }>, after?: () => void) => start(async () => {
    const r = await fn();
    setMsg(r ? { ok: r.ok, text: r.ok ? r.message ?? 'Saved.' : r.error ?? 'Something went wrong.', link: r.link } : null);
    if (r?.ok) { after?.(); router.refresh(); }
  });
  return { pending, msg, setMsg, run };
}

export function NewClient() {
  const { pending, msg, run } = useRun();
  const [f, setF] = useState({ name: '', cutoff: '12', isTest: false });
  return (
    <section className="panel">
      <h2>Add a client</h2>
      <div className="form">
        <div className="f w2"><label className="l" htmlFor="cn">Client name</label><input id="cn" type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="f"><label className="l" htmlFor="co">Short notice (hours)</label><input id="co" type="number" min={0} max={168} value={f.cutoff} onChange={(e) => setF({ ...f, cutoff: e.target.value })} /></div>
        <div className="f" style={{ justifyContent: 'flex-end' }}><label className="chip"><input type="checkbox" checked={f.isTest} onChange={(e) => setF({ ...f, isTest: e.target.checked })} /> Test client</label></div>
      </div>
      <p className="note">Requests posted later than the short-notice time are flagged urgent, and clients can’t cancel them online. Test clients are left out of reports.</p>
      <div className="btnrow" style={{ justifyContent: 'flex-end' }}>
        <button className="btn blue" disabled={pending} onClick={() => run(() => createClientAccount({ name: f.name, cutoff: parseInt(f.cutoff) || 0, isTest: f.isTest }))}>Add client</button>
      </div>
      <Note m={msg} />
    </section>
  );
}

export function ClientSettings({ id, initial, admin }: { id: string; initial: { name: string; cutoff: number; isTest: boolean; active: boolean }; admin: boolean }) {
  const { pending, msg, run } = useRun();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(initial);
  if (!open) return <button className="btn ghost small" onClick={() => setOpen(true)}>Settings</button>;
  return (
    <div className="compose" style={{ marginTop: 12, marginBottom: 0, width: '100%' }}>
      <div className="form">
        <div className="f w2"><label className="l" htmlFor="sn">Name</label><input id="sn" type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="f"><label className="l" htmlFor="sc">Short notice (hours)</label><input id="sc" type="number" min={0} max={168} value={f.cutoff} onChange={(e) => setF({ ...f, cutoff: parseInt(e.target.value) || 0 })} /></div>
        <div className="f" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <label className="chip"><input type="checkbox" checked={f.isTest} onChange={(e) => setF({ ...f, isTest: e.target.checked })} /> Test client</label>
          {admin && <label className="chip"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>}
        </div>
      </div>
      <div className="btnrow" style={{ justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={() => setOpen(false)}>Close</button>
        <button className="btn blue" disabled={pending} onClick={() => run(() => updateClientAccount(id, f))}>Save</button>
      </div>
      <Note m={msg} />
    </div>
  );
}

type Site = { id: string; name: string; address: string; postcode: string; active: boolean };

export function SiteEditor({ clientId, site }: { clientId: string; site?: Site }) {
  const { pending, msg, run } = useRun();
  const [open, setOpen] = useState(false);
  const blank = { name: '', address: '', postcode: '', active: true };
  const [f, setF] = useState(site ? { name: site.name, address: site.address, postcode: site.postcode, active: site.active } : blank);
  if (!open) return <button className="btn ghost small" onClick={() => setOpen(true)}>{site ? 'Edit' : 'Add a site'}</button>;
  return (
    <div className="compose" style={{ marginTop: 8, marginBottom: 0, textAlign: 'left' }}>
      <div className="form">
        <div className="f"><label className="l" htmlFor={`sn${site?.id ?? ''}`}>Site name</label><input id={`sn${site?.id ?? ''}`} type="text" placeholder="e.g. Bradford" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="f w2"><label className="l" htmlFor={`sa${site?.id ?? ''}`}>Address</label><input id={`sa${site?.id ?? ''}`} type="text" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
        <div className="f"><label className="l" htmlFor={`sp${site?.id ?? ''}`}>Postcode</label><input id={`sp${site?.id ?? ''}`} type="text" value={f.postcode} onChange={(e) => setF({ ...f, postcode: e.target.value })} /></div>
      </div>
      {site && <label className="chip" style={{ alignSelf: 'flex-start' }}><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> In use</label>}
      <div className="btnrow" style={{ justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={() => setOpen(false)}>Close</button>
        <button className="btn blue" disabled={pending} onClick={() => run(() => saveSite(clientId, site?.id ?? null, f), () => { if (!site) { setF(blank); setOpen(false); } })}>Save site</button>
      </div>
      <Note m={msg} />
    </div>
  );
}

export function InviteUser({ clientId, sites }: { clientId: string; sites: { id: string; name: string }[] }) {
  const { pending, msg, run } = useRun();
  const [f, setF] = useState({ email: '', name: '' });
  const [all, setAll] = useState(true);
  const [chosen, setChosen] = useState<string[]>([]);
  return (
    <div className="bar" style={{ display: 'block' }}>
      <h3>Invite a user</h3>
      <p className="note" style={{ marginTop: 0 }}>They get their own sign-in link by email. When they first sign in they add their name, mobile and job title, which then show here.</p>
      <div className="form">
        <div className="f w2"><label className="l" htmlFor="ue">Work email</label><input id="ue" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div className="f w2"><label className="l" htmlFor="un">Name (optional)</label><input id="un" type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        {sites.length > 1 && (
          <div className="f w4"><span className="l">Sites they can see</span>
            <div className="chips">
              <label className="chip"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> All sites</label>
              {!all && sites.map((s) => <label className="chip" key={s.id}><input type="checkbox" checked={chosen.includes(s.id)} onChange={() => setChosen(chosen.includes(s.id) ? chosen.filter((x) => x !== s.id) : [...chosen, s.id])} /> {s.name}</label>)}
            </div></div>
        )}
      </div>
      <div className="btnrow" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="btn blue" disabled={pending || !sites.length} onClick={() => run(() => inviteClientUser(clientId, { ...f, siteIds: all ? null : chosen }), () => { setF({ email: '', name: '' }); setChosen([]); setAll(true); })}>Send magic link</button>
      </div>
      {!sites.length && <p className="note">Add a site first.</p>}
      <Note m={msg} />
    </div>
  );
}

export function UserActions({ id, status, sites, allSites, mySites }: { id: string; status: string; sites: { id: string; name: string }[]; allSites: boolean; mySites: string[] }) {
  const { pending, msg, run } = useRun();
  const [confirm, setConfirm] = useState(false);
  const [editSites, setEditSites] = useState(false);
  const [all, setAll] = useState(allSites);
  const [chosen, setChosen] = useState(mySites);
  if (status === 'removed') return <span className="pill mute">Removed</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="btnrow">
        <button className="btn ghost small" disabled={pending} onClick={() => run(() => resendClientLink(id))}>Resend link</button>
        {sites.length > 1 && <button className="btn ghost small" onClick={() => setEditSites(!editSites)}>Sites</button>}
        {confirm
          ? <><button className="btn ghost small" onClick={() => setConfirm(false)}>Back</button><button className="btn small" style={{ background: 'var(--bad)' }} disabled={pending} onClick={() => run(() => removeClientUser(id), () => setConfirm(false))}>Yes, remove access</button></>
          : <button className="btn ghost small" onClick={() => setConfirm(true)}>Remove</button>}
      </span>
      {editSites && (
        <div className="chips">
          <label className="chip"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> All sites</label>
          {!all && sites.map((s) => <label className="chip" key={s.id}><input type="checkbox" checked={chosen.includes(s.id)} onChange={() => setChosen(chosen.includes(s.id) ? chosen.filter((x) => x !== s.id) : [...chosen, s.id])} /> {s.name}</label>)}
          <button className="btn blue small" disabled={pending} onClick={() => run(() => setUserSites(id, all ? null : chosen), () => setEditSites(false))}>Save sites</button>
        </div>
      )}
      <Note m={msg} />
    </div>
  );
}

export function LiftBlock({ id }: { id: string }) {
  const { pending, msg, run } = useRun();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  if (!open) return <button className="btn ghost small" onClick={() => setOpen(true)}>Lift block</button>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <input type="text" placeholder="Why? e.g. client agreed by phone" value={note} onChange={(e) => setNote(e.target.value)} />
      <span className="btnrow"><button className="btn ghost small" onClick={() => setOpen(false)}>Back</button>
        <button className="btn blue small" disabled={pending} onClick={() => run(() => liftBlock(id, note))}>Lift block</button></span>
      <Note m={msg} />
    </div>
  );
}
