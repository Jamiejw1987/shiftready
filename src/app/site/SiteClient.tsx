'use client';
import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { SitePhotoUpload } from '../(staff)/inductions/Controls';
import { siteSignIn, siteUploadSlot, siteRecordUpload, saveMhSite, saveDayOneSite } from './actions';
import { DayOneForm } from '@/components/DayOneForm';
import { MhForm } from '@/components/MhForm';
import type { SiteRow } from '@/lib/siteData';

function Submit() {
  const { pending } = useFormStatus();
  return <button className="btn blue" disabled={pending} style={{ width: '100%' }}>{pending ? 'Signing in…' : 'Sign in'}</button>;
}

export function SiteLoginForm() {
  const [state, action] = useFormState(siteSignIn, undefined);
  return (
    <form action={action} className="form" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="f"><label className="l" htmlFor="u">Username</label><input id="u" name="username" autoCapitalize="none" autoComplete="username" required /></div>
      <div className="f"><label className="l" htmlFor="p">Password</label><input id="p" name="password" type="password" autoComplete="current-password" required /></div>
      {state?.error && <p className="err">{state.error}</p>}
      <Submit />
    </form>
  );
}

const PILL: Record<string, [string, string]> = {
  none: ['bad', 'No induction: call the office'],
  sent: ['bad', 'Hasn’t done the induction: call the office'],
  in_progress: ['bad', 'Induction not finished: call the office'],
  signed: ['warn', 'Signed, office still checking'],
  checked: ['blue', 'Ready for day one'],
  complete: ['ok', 'Day one done'],
};

export function SiteList({ rows, trainer }: { rows: SiteRow[]; trainer: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const [mh, setMh] = useState<string | null>(null);
  const [d1, setD1] = useState<string | null>(null);
  const [q, setQ] = useState('');
  if (!rows.length) return <div className="state"><div className="badge mute">–</div><div className="big">Nobody to see yet</div><p>No one is booked today and nobody is waiting for their day one.</p></div>;
  const shown = rows.filter((r) => !q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase()));
  const firstOther = shown.findIndex((r) => !r.shift);
  return (
    <>
      <input type="search" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search by name" />
      {shown.length > 0 && shown[0].shift && <h2 className="sech" style={{ margin: '4px 0 0' }}>Booked today</h2>}
      {!shown.length && <p className="note">No one matches “{q}”.</p>}
      {shown.map((r, idx) => {
        const st = r.induction?.status ?? 'none';
        const [k, l] = PILL[st] ?? PILL.none;
        const isOpen = open === r.key;
        return (
          <div key={r.key} style={{ display: 'contents' }}>
          {idx === firstOther && <h2 className="sech" style={{ margin: '8px 0 0' }}>Waiting for day one</h2>}
          <section className="card"><div className="in" style={{ gap: 10 }}>
            <button onClick={() => setOpen(isOpen ? null : r.key)} style={{ all: 'unset', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4 }} aria-expanded={isOpen}>
              <b style={{ fontSize: 18 }}>{r.name}</b>
              <span className="note">{r.shift ? `${r.shift.client} · ${r.shift.site} · ${r.shift.start} to ${r.shift.end}` : `${r.induction?.pack ?? ''} · not booked today`}</span>
              <span><span className={`pill ${k}`}>{l}</span>{r.induction?.mh === 'todo' && r.induction.signed && <> <span className="pill warn">Manual handling to do</span></>}{r.induction?.mh === 'done' && <> <span className="pill ok">Manual handling done</span></>}</span>
            </button>
            {isOpen && r.induction && (r.induction.signed ? (
              <>
                {r.induction.mh === 'done' && <p className="okmsg">✓ Manual handling assessment done and on their file.</p>}
                {r.induction.mh === 'todo' && (mh === r.induction.id
                  ? <MhForm candidate={r.name} location={r.induction.site} trainer={trainer} save={(p) => saveMhSite(r.induction!.id, p)} />
                  : <button className="btn blue" onClick={() => setMh(r.induction!.id)}>Do manual handling assessment</button>)}
                {r.induction.siteDone && <p className="okmsg">✓ Day-one sign-off done and on their file.</p>}
                {!r.induction.siteDone && r.induction.form && (d1 === r.induction.id
                  ? <DayOneForm candidate={r.name} rep={trainer} save={(p) => saveDayOneSite(r.induction!.id, p)} />
                  : <button className="btn blue" onClick={() => setD1(r.induction!.id)}>Do day-one sign-off</button>)}
                {!r.induction.siteDone && (
                  <details><summary className="note" style={{ cursor: 'pointer' }}>Done it on paper instead? Upload a photo</summary>
                    <div style={{ marginTop: 8 }}><SitePhotoUpload camera label="Take photo of signed sheet"
                      slot={(type, size) => siteUploadSlot(r.induction!.id, type, size)} record={(paths) => siteRecordUpload(r.induction!.id, paths)} /></div>
                  </details>
                )}
              </>
            ) : <p className="alert bad">They haven’t finished the induction on their phone. Don’t let them start: call the office.</p>)}
            {isOpen && !r.induction && <p className="alert bad">No induction has been sent to them. Call the office before they start.</p>}
          </div></section>
          </div>
        );
      })}
    </>
  );
}
