'use client';
import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { seriesBook, seriesSendMore, seriesPreviewMore } from '../../actions';
import { RecipientPicker, type PickTemp } from '@/components/RecipientPicker';

type Col = { id: string; label: string; heads: number; booked: number; cancelled: boolean; past: boolean };
type Row = { id: string; name: string; mobile: string; miles: number | null; cells: Record<string, { offerId: string; status: string; available: boolean | null; awaiting: boolean }> };

export function WeekGrid({ seriesId, cols, rows }: { seriesId: string; cols: Col[]; rows: Row[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [ask, setAsk] = useState(true);
  const toggle = (id: string) => setSel((x) => { const n = new Set(x); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const people = new Set(rows.filter((r) => Object.values(r.cells).some((c) => sel.has(c.offerId))).map((r) => r.id)).size;
  const pickRow = (r: Row) => setSel((x) => {
    const n = new Set(x);
    for (const c of cols) { const cell = r.cells[c.id]; if (cell && cell.status !== 'accepted' && cell.available && !c.cancelled && !c.past) n.add(cell.offerId); }
    return n;
  });

  return (
    <>
      <div className="tablewrap" style={{ marginTop: 10 }}>
        <table className="week">
          <thead>
            <tr>
              <th>Temp</th>
              {cols.map((c) => (
                <th key={c.id} style={{ textAlign: 'center' }}>
                  <Link href={`/shifts/${c.id}`}>{c.label}</Link><br />
                  <span className={`pill ${c.cancelled ? 'bad' : c.booked >= c.heads ? 'ok' : 'warn'}`}>{c.cancelled ? 'Cancelled' : `${c.booked}/${c.heads}`}</span>
                </th>
              ))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/temps/${r.id}`}><b>{r.name}</b></Link><div className="note">{r.mobile}{r.miles != null ? ` · ${r.miles} mi` : ''}</div></td>
                {cols.map((c) => {
                  const cell = r.cells[c.id];
                  if (!cell) return <td key={c.id} className="wk-no">–</td>;
                  if (cell.status === 'accepted') return <td key={c.id} className="wk-cell">{cell.awaiting ? <span className="pill warn" title="Booked, waiting for them to confirm">To confirm</span> : <span className="pill ok">Confirmed</span>}</td>;
                  if (c.cancelled || c.past) return <td key={c.id} className="wk-no">–</td>;
                  return (
                    <td key={c.id} className="wk-cell">
                      <label className="wk-pick" title="Available: tick to book"><input type="checkbox" checked={sel.has(cell.offerId)} onChange={() => toggle(cell.offerId)} /> Free</label>
                    </td>
                  );
                })}
                <td><button className="btn ghost small" onClick={() => pickRow(r)}>All their days</button></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={cols.length + 2} className="note">Nobody has said they’re free yet. Replies appear here automatically.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="bar">
        {msg ? <p className={msg.ok ? 'okmsg' : 'err'}>{msg.text}</p> : <span className="note">{sel.size ? `${sel.size} day${sel.size === 1 ? '' : 's'} ticked for ${people} ${people === 1 ? 'person' : 'people'}` : 'Tick the days to book'}</span>}
        <div className="btnrow">
          <label className="chip"><input type="checkbox" checked={ask} onChange={(e) => setAsk(e.target.checked)} /> Ask them to confirm</label>
          {sel.size > 0 && <button className="btn ghost" onClick={() => setSel(new Set())}>Clear</button>}
          <button className="btn blue" disabled={!sel.size || pending} onClick={() => start(async () => {
            const r = await seriesBook(seriesId, [...sel], ask);
            setMsg({ ok: r.ok, text: r.ok ? r.message! : r.error! });
            if (r.ok) setSel(new Set());
            router.refresh();
          })}>{pending ? 'Booking…' : `Book and text ${people || ''} ${people === 1 ? 'person' : 'people'}`.replace('  ', ' ')}</button>
        </div>
      </div>
    </>
  );
}

export function SeriesSendMore({ seriesId, radius: r0 }: { seriesId: string; radius: number }) {
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
    const t = setTimeout(async () => load(await seriesPreviewMore(seriesId, r)), 350);
    return () => clearTimeout(t);
  }, [seriesId, radius]);
  return (
    <div className="compose" style={{ marginTop: 14, marginBottom: 0 }}>
      <h3 style={{ margin: 0 }}>Need more people? Send to more temps</h3>
      <p className="note" style={{ margin: 0 }}>Only goes to temps who haven’t had this week’s offer yet. One text each for all the days. Anyone you left out last time stays unticked unless you tick them.</p>
      <div className="btnrow">
        <label className="l" htmlFor="smR">Within</label>
        <input id="smR" type="number" min="1" max="100" value={radius} onChange={(e) => setRadius(e.target.value)} style={{ width: 100 }} />
        <span className="note">miles</span>
        {confirming && <button className="btn ghost" onClick={() => setConfirming(false)}>Back</button>}
        <button className="btn blue" disabled={pending || !count} onClick={() => {
          if (!confirming) return setConfirming(true);
          start(async () => {
            const r = await seriesSendMore(seriesId, parseFloat(radius), [...excluded]);
            setMsg({ ok: r.ok, text: r.ok ? r.message! : r.error! });
            router.refresh();
            load(await seriesPreviewMore(seriesId, parseFloat(radius)));
          });
        }}>{pending ? 'Sending…' : count == null ? 'Checking…' : !count ? (temps?.length ? 'Everyone unticked' : 'Nobody new in range') : confirming ? `Confirm and text ${count} ${count === 1 ? 'person' : 'people'}` : `Send to ${count} more temp${count === 1 ? '' : 's'}`}</button>
      </div>
      {temps && temps.length > 0 && <RecipientPicker temps={temps} excluded={excluded} setExcluded={(x) => { setExcluded(x); setConfirming(false); }} startOpen={confirming} key={confirming ? 'c' : 'n'} />}
      {msg && <p className={msg.ok ? 'okmsg' : 'err'}>{msg.text}</p>}
    </div>
  );
}
