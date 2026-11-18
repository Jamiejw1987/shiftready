'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { SignaturePad } from '@/components/SignaturePad';
import { DAY_ONE_POINTS, DAY_ONE_DECLARATION, SOM_CONFIRMATION, type DayOneInput } from '@/lib/dayOneItems';

type R = { ok: boolean; error?: string; message?: string };

/** DHL's day-one sign-off on screen: footwear question, the worker initials points 1 to 4, then both sign. */
export function DayOneForm({ candidate, rep, save }: { candidate: string; rep: string; save: (p: DayOneInput) => Promise<R> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [footwear, setFootwear] = useState<boolean | null>(null);
  const [initials, setInitials] = useState<Record<string, string>>({});
  const [workerSig, setWorkerSig] = useState<string | null>(null);
  const [somSig, setSomSig] = useState<string | null>(null);
  const [repName, setRepName] = useState(rep);
  const [repSig, setRepSig] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const first = candidate.split(' ')[0];
  const setIni = (n: number, v: string | null) => setInitials((x) => { const y = { ...x }; if (v) y[n] = v; else delete y[n]; return y; });
  const left = [footwear === true, ...[1, 2, 3, 4].map((n) => !!initials[n]), !!workerSig, !!somSig, !!repName.trim(), !!repSig].filter((x) => !x).length;

  if (msg?.ok) return <p className="okmsg">{msg.text}</p>;
  return (
    <div className="form" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p className="note" style={{ margin: 0 }}>Go through each point with {first} on site. After each one, {first} initials it with their finger. Then you both sign at the bottom.</p>

      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
        <b>Part 2. Is the temporary worker in possession of appropriate safety footwear?</b>
        <div className="btnrow" style={{ marginTop: 8 }}>
          <button type="button" className={`btn small ${footwear === true ? 'blue' : 'ghost'}`} aria-pressed={footwear === true} onClick={() => setFootwear(true)}>Yes</button>
          <button type="button" className={`btn small ${footwear === false ? 'danger' : 'ghost'}`} aria-pressed={footwear === false} onClick={() => setFootwear(false)}>No</button>
        </div>
        {footwear === false && <p className="alert bad" style={{ marginTop: 8 }}>If the temporary worker does not possess appropriate safety footwear they are not authorised to work.</p>}
      </div>

      {DAY_ONE_POINTS.map((p) => (
        <div key={p.n} style={{ borderTop: '1px solid var(--line)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <b>{p.n}. {p.title}{'bullets' in p ? ':' : ''}</b>
          {'bullets' in p && <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14 }}>{p.bullets.map((b) => <li key={b}>{b}</li>)}</ul>}
          <SignaturePad onChange={(v) => setIni(p.n, v)} label={`${first} initials point ${p.n}`} height={90} />
        </div>
      ))}

      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <b>Part 3</b>
        <p style={{ margin: 0, fontSize: 14 }}>{DAY_ONE_DECLARATION}</p>
        <SignaturePad onChange={setWorkerSig} label={`${first} signs here`} height={130} />
      </div>

      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <b>Confirmation of Safe Operating Method Briefings</b>
        <p style={{ margin: 0, fontSize: 14 }}>{SOM_CONFIRMATION}</p>
        <SignaturePad onChange={setSomSig} label={`${first} signs here`} height={130} />
      </div>

      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <b>Site Representative (Competent Person)</b>
        <div className="f"><label className="l">Name</label><input value={repName} onChange={(e) => setRepName(e.target.value)} /></div>
        <SignaturePad onChange={setRepSig} label="Site representative signs here" height={130} />
      </div>

      {msg && !msg.ok && <p className="err">{msg.text}</p>}
      <button className="btn blue" disabled={!!left || pending} onClick={() => start(async () => {
        const r = await save({ footwear, initials, repName, workerSig: workerSig!, repSig: repSig!, somSig: somSig! });
        setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Saved.' : r.error ?? 'Couldn’t save.' });
        if (r.ok) router.refresh();
      })}>{pending ? 'Saving…' : left ? `${left} still to do` : 'Save day one to their file'}</button>
    </div>
  );
}
