'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveProfile } from '../actions';

type Site = { id: string; name: string };

/** Name, mobile, job title and which sites they look after. Used on first sign-in and on the Account page. */
export function ProfileForm({ initial, sites, mySiteIds, first, done }: {
  initial: { fullName: string; mobile: string; jobTitle: string }; sites: Site[]; mySiteIds: string[]; first: boolean; done: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [f, setF] = useState(initial);
  const [chosen, setChosen] = useState<string[]>(mySiteIds);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <form noValidate onSubmit={(e) => {
      e.preventDefault();
      setMsg(null);
      start(async () => {
        const r = await saveProfile({ ...f, siteIds: sites.length > 1 ? chosen : null });
        if (!r.ok) return setMsg({ ok: false, text: r.error ?? 'Something went wrong.' });
        if (first) { router.replace(done); router.refresh(); } else { setMsg({ ok: true, text: 'Saved.' }); router.refresh(); }
      });
    }} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="f"><label className="l" htmlFor="fn">Full name</label><input id="fn" type="text" autoComplete="name" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></div>
      <div className="f"><label className="l" htmlFor="mob">Mobile</label><input id="mob" type="tel" autoComplete="tel" inputMode="tel" placeholder="07…" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} /></div>
      <div className="f"><label className="l" htmlFor="jt">Job title</label><input id="jt" type="text" autoComplete="organization-title" placeholder="e.g. Shift manager" value={f.jobTitle} onChange={(e) => setF({ ...f, jobTitle: e.target.value })} /></div>
      {sites.length > 1 && (
        <div className="f"><span className="l">Sites you look after</span>
          <div className="chips">{sites.map((s) => (
            <label className="chip" key={s.id}><input type="checkbox" checked={chosen.includes(s.id)} onChange={() => setChosen(chosen.includes(s.id) ? chosen.filter((x) => x !== s.id) : [...chosen, s.id])} /> {s.name}</label>
          ))}</div>
          <span className="note">You’ll only see shifts for these sites.</span>
        </div>
      )}
      {msg && <p className={msg.ok ? 'okmsg' : 'err'}>{msg.text}</p>}
      <button className="btn blue" disabled={pending}>{pending ? 'Saving…' : first ? 'Continue' : 'Save'}</button>
    </form>
  );
}
