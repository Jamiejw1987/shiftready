'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { previewMore, sendToMore } from '../actions';

/** Re-send an open shift only to temps who haven't had it yet. */
export function SendMore({ id, radius: r0 }: { id: string; radius: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [radius, setRadius] = useState(String(r0));
  const [count, setCount] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const r = parseFloat(radius);
    if (!(r > 0)) return setCount(null);
    const t = setTimeout(async () => { const p = await previewMore(id, r); setCount(p.ok ? p.count : null); }, 350);
    return () => clearTimeout(t);
  }, [id, radius]);

  return (
    <div className="compose" style={{ marginTop: 14, marginBottom: 0 }}>
      <h3 style={{ margin: 0 }}>Still places to fill? Send to more temps</h3>
      <p className="note" style={{ margin: 0 }}>Only goes to temps who haven’t had this shift yet, such as temps added since, or further away if you widen the radius. Nobody gets it twice.</p>
      <div className="btnrow">
        <label className="l" htmlFor="moreR">Within</label>
        <input id="moreR" type="number" min="1" max="100" value={radius} onChange={(e) => setRadius(e.target.value)} style={{ width: 100 }} />
        <span className="note">miles</span>
        <button className="btn blue" disabled={pending || !count} onClick={() => start(async () => {
          const r = await sendToMore(id, parseFloat(radius));
          setMsg({ ok: r.ok, text: r.ok ? r.message! : r.error! });
          router.refresh();
          const p = await previewMore(id, parseFloat(radius)); setCount(p.ok ? p.count : null);
        })}>{pending ? 'Sending…' : count == null ? 'Checking…' : count ? `Send to ${count} new temp${count === 1 ? '' : 's'}` : 'Nobody new in range'}</button>
      </div>
      {msg && <p className={msg.ok ? 'okmsg' : 'err'}>{msg.text}</p>}
    </div>
  );
}
