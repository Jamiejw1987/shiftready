'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CopyButton } from '@/components/Copy';
import { prepareFile, uploadToSlot } from '@/lib/upload';
import { MhForm } from '@/components/MhForm';
import { DayOneForm } from '@/components/DayOneForm';
import { saveDayOneStaff, saveMhStaff, sendInduction, resendInduction, inductionLink, updateInductionDetails, setChecked, reopenInduction, cancelInduction, siteSlotStaff, recordSiteStaff } from './actions';
import type { SendDetails } from '@/lib/inductionOps';

type Msg = { ok: boolean; text: string } | null;
const Note = ({ m }: { m: Msg }) => (m ? <p className={m.ok ? 'okmsg' : 'err'} style={{ marginTop: 10 }}>{m.text}</p> : null);
type R = { ok: boolean; error?: string; message?: string };
function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const run = (fn: () => Promise<R>, after?: () => void) =>
    start(async () => { const r = await fn(); setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Done.' : r.error ?? 'Something went wrong.' }); if (r.ok) after?.(); router.refresh(); });
  return { pending, msg, run };
}

function DetailFields({ d, set }: { d: SendDetails; set: (d: SendDetails) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
      <div className="f"><label className="l">Site</label><input value={d.site} onChange={(e) => set({ ...d, site: e.target.value })} /></div>
      <div className="f"><label className="l">Scope of work</label><input value={d.scope} onChange={(e) => set({ ...d, scope: e.target.value })} /></div>
      <div className="f"><label className="l">Start date</label><input type="date" value={d.startDate} onChange={(e) => set({ ...d, startDate: e.target.value })} /></div>
      <div className="f"><label className="l">Arrival time</label><input value={d.arrival} placeholder="06:00" onChange={(e) => set({ ...d, arrival: e.target.value })} /></div>
    </div>
  );
}

export type PackOpt = { id: string; name: string; site: string; scope: string; arrival: string };

/** On the temp's record: pick a pack, check the details printed on the form, send. */
export function SendInduction({ tempId, packs, registered, noText = false }: { tempId: string; packs: PackOpt[]; registered: boolean; noText?: boolean }) {
  const { pending, msg, run } = useRun();
  const [open, setOpen] = useState(false);
  const [packId, setPackId] = useState(packs[0]?.id ?? '');
  const pack = packs.find((p) => p.id === packId);
  const [d, setD] = useState<SendDetails>({ site: pack?.site ?? '', scope: pack?.scope ?? '', startDate: '', arrival: pack?.arrival ?? '' });
  if (!packs.length) return <p className="note" style={{ margin: 0 }}>No induction packs are switched on. An admin can add one on Team &gt; Client inductions.</p>;
  if (!open) return <button className="btn ghost" onClick={() => setOpen(true)}>Send an induction</button>;
  return (
    <div className="compose" style={{ marginTop: 4 }}>
      <div className="f"><label className="l">Induction</label>
        <select value={packId} onChange={(e) => { const p = packs.find((x) => x.id === e.target.value); setPackId(e.target.value); setD({ site: p?.site ?? '', scope: p?.scope ?? '', startDate: d.startDate, arrival: p?.arrival ?? '' }); }}>
          {packs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></div>
      <p className="note" style={{ margin: '8px 0' }}>Printed on the client’s form. You can change these later.</p>
      <DetailFields d={d} set={setD} />
      {noText && <p className="note">Their messages are off, so ShiftReady won’t text them. It’s added to their record: use <b>Copy link</b> and send it to them yourself (e.g. WhatsApp).</p>}
      {!noText && !registered && <p className="note">They haven’t registered yet: the text asks them to do the induction once they have. They can do it in either order.</p>}
      <div className="btnrow" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
        <button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
        <button className="btn blue" disabled={pending || !packId} onClick={() => run(() => sendInduction(tempId, packId, d), () => setOpen(false))}>{noText ? 'Add induction' : 'Send by text'}</button>
      </div>
      <Note m={msg} />
    </div>
  );
}

/** Buttons for one induction (temp record and the induction's own page). */
export function InductionButtons({ id, status, details, full = false }: { id: string; status: string; details: SendDetails; full?: boolean }) {
  const { pending, msg, run } = useRun();
  const [edit, setEdit] = useState(false);
  const [d, setD] = useState(details);
  const live = status !== 'cancelled';
  return (
    <>
      <div className="btnrow">
        {live && !['signed', 'checked', 'complete'].includes(status) && <>
          <button className="btn ghost small" disabled={pending} onClick={() => run(() => resendInduction(id))}>Resend link</button>
          <CopyButton text={() => inductionLink(id)} label="Copy link" className="btn ghost small" />
        </>}
        {!full && <a className="btn ghost small" href={`/inductions/${id}`}>{status === 'signed' ? 'Check signatures' : 'Open'}</a>}
        {['signed', 'checked', 'complete'].includes(status) && <a className="btn ghost small" href={`/api/inductions/${id}/pdf`} target="_blank" rel="noopener noreferrer">Signed PDF</a>}
        {live && <a className="btn ghost small" href={`/api/inductions/${id}/dayone`} target="_blank" rel="noopener noreferrer">Print day-one sheet</a>}
        {full && live && <button className="btn ghost small" onClick={() => setEdit(!edit)}>Form details</button>}
        {full && status === 'signed' && <button className="btn blue small" disabled={pending} onClick={() => run(() => setChecked(id, true))}>Signatures checked: OK for site</button>}
        {full && (status === 'checked' || status === 'complete') && <button className="btn ghost small" disabled={pending} onClick={() => run(() => setChecked(id, false))}>Undo check</button>}
        {full && live && ['in_progress', 'signed', 'checked', 'complete'].includes(status) && <button className="btn ghost small danger" disabled={pending} onClick={() => {
          if (confirm('Clear every tick and signature so they sign it all again? Use this if a signature isn’t acceptable.')) run(() => reopenInduction(id));
        }}>Make them sign again</button>}
        {full && live && <button className="btn ghost small danger" disabled={pending} onClick={() => { if (confirm('Cancel this induction? Their link stops working.')) run(() => cancelInduction(id)); }}>Cancel induction</button>}
      </div>
      {edit && (
        <div className="compose" style={{ marginTop: 10 }}>
          <DetailFields d={d} set={setD} />
          <div className="btnrow" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
            <button className="btn blue small" disabled={pending} onClick={() => run(() => updateInductionDetails(id, d), () => setEdit(false))}>Save</button>
          </div>
        </div>
      )}
      <Note m={msg} />
    </>
  );
}

/** Upload photos of the signed day-one paper sheet. Shared by the office and the site login. */
export function SitePhotoUpload({ slot, record, label = 'Upload photo of signed sheet', camera = false }: {
  slot: (type: string, size: number) => Promise<{ ok: true; path: string; token: string } | { ok: false; error: string }>;
  record: (paths: { path: string; filename: string }[]) => Promise<R>;
  label?: string; camera?: boolean;
}) {
  const { pending, msg, run } = useRun();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    setBusy(true); setErr('');
    const done: { path: string; filename: string }[] = [];
    for (const f of files.slice(0, 6)) {
      const p = await prepareFile(f);
      const s = await slot(p.type, p.blob.size);
      if (!s.ok) { setErr(s.error); continue; }
      if (await uploadToSlot(s.path, s.token, p.blob, p.type)) done.push({ path: s.path, filename: p.name });
      else setErr('An upload failed. Check your signal and try again.');
    }
    setBusy(false);
    if (done.length) run(() => record(done));
  };
  return (
    <div>
      <label className="btn blue" style={{ cursor: 'pointer' }} aria-disabled={busy || pending}>
        {busy || pending ? 'Uploading…' : label}
        <input type="file" accept="image/*,application/pdf" capture={camera ? 'environment' : undefined} multiple hidden disabled={busy || pending} onChange={(e) => { go(e.target.files); e.target.value = ''; }} />
      </label>
      {err && <p className="err" style={{ marginTop: 8 }}>{err}</p>}
      <Note m={msg} />
    </div>
  );
}

export function StaffSiteUpload({ id }: { id: string }) {
  return <SitePhotoUpload slot={(type, size) => siteSlotStaff(id, type, size)} record={(paths) => recordSiteStaff(id, paths)} />;
}

export function StaffMh({ id, candidate, location, trainer }: { id: string; candidate: string; location: string; trainer: string }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button className="btn ghost" onClick={() => setOpen(true)}>Do manual handling assessment</button>;
  return <MhForm candidate={candidate} location={location} trainer={trainer} save={(p) => saveMhStaff(id, p)} />;
}

export function StaffDayOne({ id, candidate, rep }: { id: string; candidate: string; rep: string }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button className="btn blue" onClick={() => setOpen(true)}>Do day-one sign-off</button>;
  return <DayOneForm candidate={candidate} rep={rep} save={(p) => saveDayOneStaff(id, p)} />;
}
