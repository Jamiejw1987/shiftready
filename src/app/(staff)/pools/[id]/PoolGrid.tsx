'use client';
import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setPoolDays, setWeekDay, removeFromPool, sendPoolText, poolBookedOn } from '../actions';
import { POOL_DAYS } from '../days';

export type PoolRow = {
  id: string; tempId: string; name: string; first: string; mobile: string; days: number[]; lastShift: string | null;
  manual: boolean; canText: boolean; why: string;
  /** Week view: who set each day. worker = they ticked it, office = added by the office, removed = they ticked it but the office took it off. */
  state?: Record<number, 'worker' | 'office' | 'removed'>;
  /** Week view: replied, reminded (no reply yet), asked (no reply yet), or not asked. */
  reply?: 'replied' | 'reminded' | 'asked' | 'none';
};

const REPLY: Record<string, [string, string]> = {
  replied: ['ok', 'Replied'], reminded: ['warn', 'No reply (reminded)'], asked: ['warn', 'No reply yet'], none: ['mute', 'Not asked'],
};
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Today in the UK as YYYY-MM-DD. */
const todayUK = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
/** The next date (today or later) that falls on this weekday, 1 = Mon ... 7 = Sun. */
const nextOn = (n: number) => {
  const t = new Date(todayUK() + 'T12:00:00Z');
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + ((n - dow + 7) % 7));
  return t.toISOString().slice(0, 10);
};
const dowOf = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay() || 7;
const longDate = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
const shortDate = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** `week` (a Monday) shows that week's availability (what they ticked, plus office changes); without it, their usual days. */
export function PoolGrid({ poolId, rows: initial, siteLabel, week }: { poolId: string; rows: PoolRow[]; siteLabel: string; week?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rows, setRows] = useState(initial);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [day, setDay] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [date, setDate] = useState('');
  const [booked, setBooked] = useState<Record<string, string>>({}); // member id -> client they're already booked at that day
  const [checking, setChecking] = useState(false);

  // Whenever the date changes, find who already has a shift that day and take them out of the ticked list.
  useEffect(() => {
    if (!date) { setBooked({}); return; }
    let live = true;
    setChecking(true);
    poolBookedOn(poolId, date).then((b) => {
      if (!live) return;
      setBooked(b); setChecking(false);
      setSel((x) => new Set([...x].filter((id) => !b[id])));
    });
    return () => { live = false; };
  }, [poolId, date]);

  // Keep local state in step after the page refreshes (someone added or removed).
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) { setSeen(initial); setRows(initial); }

  const flip = (r: PoolRow, n: number) => {
    if (week) {
      // Office change for this week: always wins over what they ticked. Shown in blue so everyone can tell.
      const was = { days: r.days, state: r.state };
      const on = !r.days.includes(n);
      const st = { ...(r.state ?? {}) };
      if (on) st[n] = st[n] === 'removed' ? 'worker' : 'office'; else if (st[n] === 'worker') st[n] = 'removed'; else delete st[n];
      setRows((all) => all.map((x) => (x.id === r.id ? { ...x, days: on ? [...r.days, n].sort() : r.days.filter((d) => d !== n), state: st } : x)));
      setWeekDay(poolId, r.tempId, week, n, on).then((res) => {
        if (!res.ok) {
          setRows((all) => all.map((x) => (x.id === r.id ? { ...x, ...was } : x)));
          setMsg({ ok: false, text: res.error ?? 'Couldn’t save that. Try again.' });
        }
      });
      return;
    }
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
    // Week view: that day of the week shown. Usual days: keep the date if it's on this weekday, otherwise the next one.
    if (week) setDate(addDays(week, n - 1));
    else if (!date || dowOf(date) !== n) setDate(nextOn(n));
    setSel(new Set(rows.filter((r) => r.days.includes(n) && r.canText && !booked[r.id]).map((r) => r.id)));
    setMsg(null);
  };
  const toggle = (id: string) => setSel((x) => { const s = new Set(x); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const textable = rows.filter((r) => r.canText && !booked[r.id]);
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
                    {d.short}{week && <em>{shortDate(addDays(week, d.n - 1))}</em>}<span>{counts[i]}</span>
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
                    <input type="checkbox" checked={sel.has(r.id)} disabled={!r.canText || !!booked[r.id]} onChange={() => toggle(r.id)} aria-label={`Text ${r.name}`} />
                    <span>
                      <Link href={`/temps/${r.tempId}`}><b>{r.name}</b></Link>
                      <span className="note">{r.mobile}{r.lastShift ? ` · last here ${shortDate(r.lastShift)}` : r.manual ? ' · added by hand' : ''}</span>
                      {r.why && <span className="pill mute">{r.why}</span>}
                      {week && r.reply && !r.why && <span className={`pill ${REPLY[r.reply][0]}`}>{REPLY[r.reply][1]}</span>}
                      {booked[r.id] && <span className="pill bad">Booked that day: {booked[r.id]}</span>}
                    </span>
                  </label>
                </td>
                {POOL_DAYS.map((d) => {
                  const on = r.days.includes(d.n);
                  const st = week ? r.state?.[d.n] : undefined;
                  const how = st === 'office' ? ' office' : st === 'removed' ? ' removed' : '';
                  const tip = st === 'office' ? 'Added by the office' : st === 'removed' ? 'They ticked this, but the office took it off' : st === 'worker' ? 'They ticked this' : undefined;
                  return (
                    <td key={d.n} className="pool-cell">
                      <button type="button" className={`pool-tog${on ? ' on' : ''}${how}`} title={tip} aria-pressed={on} aria-label={`${r.name} ${on ? 'can do' : 'can’t do'} ${d.long}${tip ? `: ${tip}` : ''}`} onClick={() => flip(r, d.n)}>
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
          <tfoot>
            <tr className="pool-total">
              <th className="pool-who">Can work{week ? '' : ' (usual)'} <span className="note">of {rows.length}</span></th>
              {POOL_DAYS.map((d, i) => <td key={d.n} className="pool-cell"><b>{counts[i]}</b></td>)}
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="compose" style={{ marginTop: 16, marginBottom: 0 }}>
        <h3 style={{ margin: 0 }}>Text {sel.size ? `${sel.size} ${sel.size === 1 ? 'person' : 'people'}` : 'the pool'}{date && sel.size ? ` for ${longDate(date)}` : ''}</h3>
        <label className="pool-date">Shift date
          <input type="date" value={date} min={todayUK()} onChange={(e) => { setDate(e.target.value); setMsg(null); }} />
        </label>
        <p className="note" style={{ margin: 0 }}>Tap a day heading to tick everyone green that day, or tick people one by one. Anyone who already has a shift on the date (booked or provisionally accepted) is left out and can’t be texted. <b>{'{first}'}</b> becomes their first name.</p>
        {checking && <span className="note">Checking who’s already working that day…</span>}
        <textarea rows={4} maxLength={600} value={text} onChange={(e) => { setText(e.target.value); setMsg(null); }}
          placeholder={`Hi {first}, we’ve got a short-notice shift at ${siteLabel}${date ? ` on ${longDate(date)}` : chosenDay ? ` on ${chosenDay.long}` : ''}. Call the office if you can do it.`} />
        <div className="btnrow">
          <button className="btn blue" disabled={pending || checking || !sel.size || !text.trim() || !date} onClick={() => {
            if (!confirm(`Send this text to ${sel.size} ${sel.size === 1 ? 'person' : 'people'} for ${longDate(date)}?`)) return;
            start(async () => {
              const res = await sendPoolText(poolId, [...sel], text, date);
              setMsg({ ok: res.ok, text: res.ok ? res.message! : res.error! });
              if (res.ok) { setText(''); setSel(new Set()); setDay(null); }
            });
          }}>{pending ? 'Sending…' : 'Send text'}</button>
          {sel.size > 0 && <button className="btn ghost" disabled={pending} onClick={() => { setSel(new Set()); setDay(null); }}>Clear</button>}
          <span className="note">{!date ? 'Pick the shift date first. ' : ''}{text.length}/600</span>
        </div>
        {msg && <p className={msg.ok ? 'okmsg' : 'err'}>{msg.text}</p>}
      </div>
    </>
  );
}
