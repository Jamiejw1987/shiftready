'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { previewMore, sendToMore } from '../actions';
import { RecipientPicker, type PickTemp } from '@/components/RecipientPicker';

/** Re-send an open shift only to temps who haven't had it yet. */
export function SendMore({ id, radius: r0 }: { id: string; radius: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [radius, setRadius] = useState(String(r0));
  const [temps, setTemps] = useState<PickTemp[] | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const count = temps == null ? null : temps.filter((t) => !excluded.has(t.id)).length;
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  // People unticked when the shift went out before start unticked again, so they never get it by surprise.
  const load = (list: PickTemp[] | null) => { setTemps(list); setExcluded(new Set((list ?? []).filter((t) => t.leftOut).map((t) => t.id))); setConfirming(false); };

  useEffect(() => {
    const r = parseFloat(radius);
    if (!(r > 0)) return setTemps(null);
    const t = setTimeout(async () => { const p = await previewMore(id, r); load(p.ok ? p.temps : null); }, 350);
    return () => clearTimeout(t);
  }, [id, radius]);

  return (
    <div className="compose" style={{ marginTop: 14, marginBottom: 0 }}>
      <h3 style={{ margin: 0 }}>Still places to fill? Send to more temps</h3>
      <p className="note" style={{ margin: 0 }}>Only goes to temps who haven’t had this shift yet, such as temps added since, or further away if you widen the radius. Nobody gets it twice, and anyone you left out last time stays unticked unless you tick them.</p>
      <div className="btnrow">
        <label className="l" htmlFor="moreR">Within</label>
        <input id="moreR" type="number" min="1" max="100" value={radius} onChange={(e) => setRadius(e.target.value)} style={{ width: 100 }} />
        <span className="note">miles</span>
        {confirming && <button className="btn ghost" onClick={() => setConfirming(false)}>Back</button>}
        <button className="btn blue" disabled={pending || !count} onClick={() => {
          if (!confirming) return setConfirming(true);
          start(async () => {
            const r = await sendToMore(id, parseFloat(radius), [...excluded]);
            setMsg({ ok: r.ok, text: r.ok ? r.message! : r.error! });
            router.refresh();
            const p = await previewMore(id, parseFloat(radius)); load(p.ok ? p.temps : null);
          });
        }}>{pending ? 'Sending…' : count == null ? 'Checking…' : !count ? (temps?.length ? 'Everyone unticked' : 'Nobody new in range') : confirming ? `Confirm and text ${count} ${count === 1 ? 'person' : 'people'}` : `Send to ${count} more temp${count === 1 ? '' : 's'}`}</button>
      </div>
      {temps && temps.length > 0 && <RecipientPicker temps={temps} excluded={excluded} setExcluded={(x) => { setExcluded(x); setConfirming(false); }} startOpen={confirming} key={confirming ? 'c' : 'n'} />}
      {msg && <p className={msg.ok ? 'okmsg' : 'err'}>{msg.text}</p>}
    </div>
  );
}
