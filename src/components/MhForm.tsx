'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { SignaturePad } from '@/components/SignaturePad';
import { MH_ITEMS } from '@/lib/mhItems';

type R = { ok: boolean; error?: string; message?: string };
export type MhPayload = { answers: Record<string, boolean>; location: string; trainerName: string; coaching: string; candidateSig: string; trainerSig: string };

/** The manual handling practical assessment on screen: Yes/No for every check, then both sign. */
export function MhForm({ candidate, location: loc0, trainer: tr0, save }: { candidate: string; location: string; trainer: string; save: (p: MhPayload) => Promise<R> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const [location, setLocation] = useState(loc0);
  const [trainerName, setTrainer] = useState(tr0);
  const [coaching, setCoaching] = useState('');
  const [cSig, setCSig] = useState<string | null>(null);
  const [tSig, setTSig] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const groups = useMemo(() => {
    const g: { heading: string; section: string; items: typeof MH_ITEMS }[] = [];
    for (const i of MH_ITEMS) {
      const last = g[g.length - 1];
      if (last && last.heading === i.heading) last.items.push(i); else g.push({ heading: i.heading, section: i.section, items: [i] });
    }
    return g;
  }, []);
  const left = MH_ITEMS.filter((i) => answers[i.id] === undefined).length;
  const noSections = Array.from(new Set(MH_ITEMS.filter((i) => answers[i.id] === false).map((i) => i.section)));
  const ready = !left && !!cSig && !!tSig && !!trainerName.trim() && (!noSections.length || !!coaching.trim());

  if (msg?.ok) return <p className="okmsg">{msg.text}</p>;
  return (
    <div className="form" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p className="note" style={{ margin: 0 }}>Watch {candidate} do each one, then tap <b>Yes</b> if they demonstrated it properly or <b>No</b> if not.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <div className="f"><label className="l">Assessment location</label><input value={location} onChange={(e) => setLocation(e.target.value)} /></div>
        <div className="f"><label className="l">Trainer</label><input value={trainerName} onChange={(e) => setTrainer(e.target.value)} /></div>
      </div>
      {groups.map((g) => (
        <div key={g.heading} style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
          <b>{/^\d/.test(g.section) ? `${g.section}. ` : ''}{g.heading}</b>
          {g.items.map((i) => (
            <div key={i.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '6px 0' }}>
              <span style={{ fontSize: 15 }}>{i.text ?? ''}</span>
              <span style={{ display: 'flex', gap: 6, flex: 'none' }}>
                <button type="button" className={`btn small ${answers[i.id] === true ? 'blue' : 'ghost'}`} aria-pressed={answers[i.id] === true} onClick={() => setAnswers({ ...answers, [i.id]: true })}>Yes</button>
                <button type="button" className={`btn small ${answers[i.id] === false ? 'danger' : 'ghost'}`} style={answers[i.id] === false ? { background: 'var(--red, #d33)', color: '#fff' } : undefined} aria-pressed={answers[i.id] === false} onClick={() => setAnswers({ ...answers, [i.id]: false })}>No</button>
              </span>
            </div>
          ))}
        </div>
      ))}
      {noSections.length > 0 && (
        <div className="f"><label className="l">Corrective coaching given and done successfully on section(s)</label>
          <input value={coaching} placeholder={noSections.join(', ')} onChange={(e) => setCoaching(e.target.value)} /></div>
      )}
      <b>{candidate}’s signature</b>
      <SignaturePad onChange={setCSig} label={`${candidate.split(' ')[0]} signs here`} height={140} />
      <b>Trainer’s signature</b>
      <SignaturePad onChange={setTSig} label="Trainer signs here" height={140} />
      {msg && !msg.ok && <p className="err">{msg.text}</p>}
      <button className="btn blue" disabled={!ready || pending} onClick={() => start(async () => {
        const r = await save({ answers, location, trainerName, coaching, candidateSig: cSig!, trainerSig: tSig! });
        setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Saved.' : r.error ?? 'Couldn’t save.' });
        if (r.ok) router.refresh();
      })}>{pending ? 'Saving…' : left ? `${left} check${left === 1 ? '' : 's'} to answer` : 'Save to their file'}</button>
    </div>
  );
}
