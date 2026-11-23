'use client';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setPoolDays, removeFromPool, sendPoolText } from '../actions';
import { POOL_DAYS } from '../days';

export type PoolRow = {
  id: string; tempId: string; name: string; first: string; mobile: string; days: number[]; lastShift: string | null;
  manual: boolean; canText: boolean; why: string;
};

const shortDate = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export function PoolGrid({ poolId, rows: initial, siteLabel }: { poolId: string; rows: PoolRow[]; siteLabel: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rows, setRows] = useState(initial);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [day, setDay] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Keep local state in step after the page refreshes (someone added or removed).
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) { setSeen(initial); setRows(initial); }

  const flip = (r: PoolRow, n: number) => {
    const before = r.days;
    const next = before.includes(n) ? before.filter((d) => d !== n) : [...before, n].sort();
    setRows((all) => all.map((x) => (x.id === r.id ? { ...x, days: next } : x)));
    setPoolDays(r.id, next).then((res) => {
      if (!res.ok) {
        setRows((all) => all.map((x) => (x.id === r.id ? { ...x, days: before } : x)));
        setMsg({ ok: false, text: res.error ?? 'Couldn’t save that. Try again.' });
      }
    });
  };
  const pickDay = (n: number) => {
    setDay(n);
    setSel(new Set(rows.filter((r) => r.days.includes(n) && r.canText).map((r) => r.id)));
    setMsg(null);
  };
  const toggle = (id: string) => setSel((x) => { const s = new Set(x); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const textable = rows.filter((r) => r.canText);
  const allOn = textable.length > 0 && textable.every((r) => sel.has(r.id));
  const counts = POOL_DAYS.map((d) => rows.filter((r) => r.days.includes(d.n)).length);
  const chosenDay = POOL_DAYS.find((d) => d.n === day);

  if (!rows.length) return <p className="note">Nobody in this pool yet. People are added automatically when they’re booked on a shift here, or add someone below.</p>;

  return (
    <>
      <div className="tablewrap">
        <table className="pool">
          <thead>
            <tr>
              <th className="pool-who">
                <label className="pool-all"><input type="checkbox" checked={allOn} onChange={() => { setDay(null); setSel(allOn ? new Set() : new Set(textable.map((r) => r.id))); }} /> Worker</label>
              </th>
              {POOL_DAYS.map((d, i) => (
                <th key={d.n} className="pool-day">
                  <button type="button" className={`pool-dayhead${day === d.n ? ' on' : ''}`} onClick={() => pickDay(d.n)} title={`Tick everyone free on ${d.long}`}>
                    {d.short}<span>{counts[i]}</span>
                  </button>
                </th>
              ))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={sel.has(r.id) ? 'picked' : ''}>
                <td className="pool-who">
                  <label className="pool-name">
                    <input type="checkbox" checked={sel.has(r.id)} disabled={!r.canText} onChange={() => toggle(r.id)} aria-label={`Text ${r.name}`} />
                    <span>
                      <Link href={`/temps/${r.tempId}`}><b>{r.name}</b></Link>
                      <span className="note">{r.mobile}{r.lastShift ? ` · last here ${shortDate(r.lastShift)}` : r.manual ? ' · added by hand' : ''}</span>
                      {r.why && <span className="pill mute">{r.why}</span>}
                    </span>
                  </label>
                </td>
                {POOL_DAYS.map((d) => {
                  const on = r.days.includes(d.n);
                  return (
                    <td key={d.n} className="pool-cell">
                      <button type="button" className={`pool-tog${on ? ' on' : ''}`} aria-pressed={on} aria-label={`${r.name} ${on ? 'wants' : 'doesn’t want'} ${d.long}`} onClick={() => flip(r, d.n)}>
                        {on ? '✓' : ''}
                      </button>
                    </td>
                  );
                })}
                <td>
                  <button type="button" className="btn ghost small" disabled={pending} title="Take out of this pool" onClick={() => {
                    if (!confirm(`Take ${r.name} out of this pool?`)) return;
                    start(async () => { const res = await removeFromPool(r.id); setMsg({ ok: res.ok, text: res.ok ? res.message! : res.error! }); if (res.ok) router.refresh(); });
                  }}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="compose" style={{ marginTop: 16, marginBottom: 0 }}>
        <h3 style={{ margin: 0 }}>Text {sel.size ? `${sel.size} ${sel.size === 1 ? 'person' : 'people'}` : 'the pool'}{chosenDay && sel.size ? ` free on ${chosenDay.long}` : ''}</h3>
        <p className="note" style={{ margin: 0 }}>Tap a day heading to tick everyone green that day, or tick people one by one. <b>{'{first}'}</b> becomes their first name.</p>
        <textarea rows={4} maxLength={600} value={text} onChange={(e) => { setText(e.target.value); setMsg(null); }}
          placeholder={`Hi {first}, we’ve got a short-notice shift at ${siteLabel}${chosenDay ? ` on ${chosenDay.long}` : ''}. Call the office if you can do it.`} />
        <div className="btnrow">
          <button className="btn blue" disabled={pending || !sel.size || !text.trim()} onClick={() => {
            if (!confirm(`Send this text to ${sel.size} ${sel.size === 1 ? 'person' : 'people'}?`)) return;
            start(async () => {
              const res = await sendPoolText(poolId, [...sel], text);
              setMsg({ ok: res.ok, text: res.ok ? res.message! : res.error! });
              if (res.ok) { setText(''); setSel(new Set()); setDay(null); }
            });
          }}>{pending ? 'Sending…' : 'Send text'}</button>
          {sel.size > 0 && <button className="btn ghost" disabled={pending} onClick={() => { setSel(new Set()); setDay(null); }}>Clear</button>}
          <span className="note">{text.length}/600</span>
        </div>
        {msg && <p className={msg.ok ? 'okmsg' : 'err'}>{msg.text}</p>}
      </div>
    </>
  );
}
