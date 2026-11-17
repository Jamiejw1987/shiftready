'use client';
import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { SitePhotoUpload } from '../(staff)/inductions/Controls';
import { siteSignIn, siteUploadSlot, siteRecordUpload } from './actions';
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

export function SiteList({ rows }: { rows: SiteRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!rows.length) return <div className="state"><div className="badge mute">–</div><div className="big">Nobody booked</div><p>No one is booked on today’s shifts for your site yet.</p></div>;
  return (
    <>
      {rows.map((r) => {
        const st = r.induction?.status ?? 'none';
        const [k, l] = PILL[st] ?? PILL.none;
        const isOpen = open === r.offerId;
        return (
          <section key={r.offerId} className="card"><div className="in" style={{ gap: 10 }}>
            <button onClick={() => setOpen(isOpen ? null : r.offerId)} style={{ all: 'unset', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4 }} aria-expanded={isOpen}>
              <b style={{ fontSize: 18 }}>{r.name}</b>
              <span className="note">{r.shift.client} · {r.shift.site} · {r.shift.start} to {r.shift.end}</span>
              <span><span className={`pill ${k}`}>{l}</span></span>
            </button>
            {isOpen && r.induction && (r.induction.signed ? (
              <>
                {r.induction.siteDone && <p className="okmsg">Photo already uploaded. You can add another if the first wasn’t clear.</p>}
                <a className="btn ghost" href={`/api/inductions/${r.induction.id}/dayone`} target="_blank" rel="noopener noreferrer">Open the day-one sheet to print</a>
                <SitePhotoUpload camera label={r.induction.siteDone ? 'Add another photo' : 'Take photo of signed sheet'}
                  slot={(type, size) => siteUploadSlot(r.induction!.id, type, size)} record={(paths) => siteRecordUpload(r.induction!.id, paths)} />
              </>
            ) : <p className="alert bad">They haven’t finished the induction on their phone. Don’t let them start: call the office.</p>)}
            {isOpen && !r.induction && <p className="alert bad">No induction has been sent to them. Call the office before they start.</p>}
          </div></section>
        );
      })}
    </>
  );
}
