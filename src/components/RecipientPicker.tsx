'use client';
import { useMemo, useState } from 'react';

export type PickTemp = { id: string; name: string; miles: number };

/**
 * "Who it goes to": the temps a shift offer would be sent to, nearest first, each with a tick.
 * Untick anyone who shouldn't get it. `excluded` holds the unticked temps.
 */
export function RecipientPicker({ temps, excluded, setExcluded, startOpen = false }: {
  temps: PickTemp[]; excluded: Set<string>; setExcluded: (s: Set<string>) => void; startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const [q, setQ] = useState('');
  const going = temps.filter((t) => !excluded.has(t.id)).length;
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? temps.filter((t) => t.name.toLowerCase().includes(s)) : temps;
  }, [q, temps]);
  if (!temps.length) return null;

  const toggle = (id: string) => {
    const next = new Set(excluded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExcluded(next);
  };
  const setAll = (on: boolean) => {
    const next = new Set(excluded);
    for (const t of shown) if (on) next.delete(t.id); else next.add(t.id);
    setExcluded(next);
  };

  return (
    <div className="pick">
      <button type="button" className="pick-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span><b>{going}</b> of {temps.length} ticked{excluded.size ? ` · ${temps.length - going} left out` : ''}</span>
        <span className="pick-toggle">{open ? 'Hide names' : 'See names'}</span>
      </button>
      {open && (
        <>
          <div className="pick-tools">
            {temps.length > 8 && <input type="search" placeholder="Find a name" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />}
            <div className="btnrow">
              <button type="button" className="btn ghost small" onClick={() => setAll(true)}>Tick all{q ? ' shown' : ''}</button>
              <button type="button" className="btn ghost small" onClick={() => setAll(false)}>Untick all{q ? ' shown' : ''}</button>
            </div>
          </div>
          <ul className="pick-list">
            {shown.map((t) => (
              <li key={t.id}>
                <label className={excluded.has(t.id) ? 'off' : ''}>
                  <input type="checkbox" checked={!excluded.has(t.id)} onChange={() => toggle(t.id)} />
                  <span className="pick-name">{t.name}</span>
                  <span className="pick-mi">{t.miles} mi</span>
                </label>
              </li>
            ))}
            {!shown.length && <li className="note" style={{ padding: 8 }}>Nobody matches that name.</li>}
          </ul>
        </>
      )}
    </div>
  );
}
