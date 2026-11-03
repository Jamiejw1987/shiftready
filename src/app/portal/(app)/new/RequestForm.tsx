'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createRequests } from '../../actions';

type Tpl = { id: string; name: string; siteId: string; start: string; end: string; role: string; headcount: number; notes: string };

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (s: string, n: number) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const label = (s: string) => new Date(s + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

export function RequestForm({ sites, templates, roles, cutoff, startTemplate }: { sites: { id: string; name: string }[]; templates: Tpl[]; roles: string[]; cutoff: number; startTemplate: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const tomorrow = addDays(iso(new Date()), 1);
  const t0 = templates.find((t) => t.id === startTemplate);
  const [tplId, setTplId] = useState<string | null>(t0?.id ?? null);
  const [f, setF] = useState({
    siteId: t0?.siteId ?? sites[0]?.id ?? '', start: t0?.start ?? '06:00', end: t0?.end ?? '14:00', role: t0?.role ?? roles[0],
    headcount: t0?.headcount ?? 1, notes: t0?.notes ?? '',
  });
  const [dates, setDates] = useState<string[]>([tomorrow]);
  const [save, setSave] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [err, setErr] = useState('');

  const pickTpl = (t: Tpl | null) => {
    setTplId(t?.id ?? null);
    if (t) setF({ siteId: t.siteId, start: t.start, end: t.end, role: t.role, headcount: t.headcount, notes: t.notes });
  };
  const short = useMemo(() => dates.some((d) => {
    const at = new Date(`${d}T${f.start}:00`).getTime();
    return at - Date.now() < cutoff * 36e5;
  }), [dates, f.start, cutoff]);
  const setDate = (i: number, v: string) => setDates(dates.map((d, j) => (j === i ? v : d)));
  const weekly = () => {
    const base = dates[dates.length - 1] || tomorrow;
    const more = [1, 2, 3].map((w) => addDays(base, 7 * w));
    setDates([...new Set([...dates, ...more])].sort().slice(0, 14));
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (save && !saveName.trim()) return setErr('Give the saved shift a name, e.g. “Friday lates”.');
    start(async () => {
      const r = await createRequests({ ...f, dates, templateId: tplId, saveAs: save ? saveName : null });
      if (!r.ok) return setErr(r.error ?? 'Something went wrong.');
      router.push(r.id ? `/portal/requests/${r.id}?sent=1` : '/portal');
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} noValidate className="rform">
      {templates.length > 0 && (
        <div className="f"><span className="l">Start from a saved shift</span>
          <div className="chips">
            {templates.map((t) => (
              <button type="button" key={t.id} className={`chip${tplId === t.id ? ' on' : ''}`} onClick={() => pickTpl(tplId === t.id ? null : t)}>{t.name}</button>
            ))}
          </div>
        </div>
      )}
      <div className="form">
        {sites.length > 1 && (
          <div className="f w2"><label className="l" htmlFor="site">Site</label>
            <select id="site" value={f.siteId} onChange={(e) => setF({ ...f, siteId: e.target.value })}>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        )}
        <div className="f"><label className="l" htmlFor="role">Type of work</label>
          <select id="role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{roles.map((r) => <option key={r}>{r}</option>)}</select></div>
        <div className="f"><label className="l" htmlFor="hc">People needed</label>
          <div className="stepper">
            <button type="button" aria-label="Fewer" onClick={() => setF({ ...f, headcount: Math.max(1, f.headcount - 1) })}>−</button>
            <input id="hc" type="number" inputMode="numeric" min={1} max={200} value={f.headcount} onChange={(e) => setF({ ...f, headcount: Math.max(1, Math.min(200, parseInt(e.target.value) || 1)) })} />
            <button type="button" aria-label="More" onClick={() => setF({ ...f, headcount: Math.min(200, f.headcount + 1) })}>+</button>
          </div></div>
        <div className="f"><label className="l" htmlFor="st">Start</label><input id="st" type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></div>
        <div className="f"><label className="l" htmlFor="en">Finish</label><input id="en" type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></div>
        <div className="f w4"><span className="l">{dates.length > 1 ? `Dates (${dates.length})` : 'Date'}</span>
          <div className="dates">
            {dates.map((d, i) => (
              <span key={i} className="dateitem">
                <input type="date" aria-label={`Date ${i + 1}`} min={iso(new Date())} value={d} onChange={(e) => setDate(i, e.target.value)} />
                <span className="note">{d ? label(d) : ''}</span>
                {dates.length > 1 && <button type="button" className="linkbtn" onClick={() => setDates(dates.filter((_, j) => j !== i))}>Remove</button>}
              </span>
            ))}
          </div>
          <div className="btnrow">
            {dates.length < 14 && <button type="button" className="btn ghost small" onClick={() => setDates([...dates, addDays(dates[dates.length - 1] || tomorrow, 1)])}>Add another date</button>}
            {dates.length < 12 && <button type="button" className="btn ghost small" onClick={weekly}>Same day for the next 3 weeks</button>}
          </div>
        </div>
        <div className="f w4"><label className="l" htmlFor="notes">Notes for our team (optional)</label>
          <textarea id="notes" maxLength={500} placeholder="e.g. report to Gate 3, ask for Dave" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
      </div>
      <label className="chip" style={{ alignSelf: 'flex-start' }}><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} /> Save as a regular shift so I can repeat it in one tap</label>
      {save && <div className="f" style={{ maxWidth: 360 }}><label className="l" htmlFor="sn">Name it</label><input id="sn" type="text" maxLength={60} placeholder="e.g. Friday lates" value={saveName} onChange={(e) => setSaveName(e.target.value)} /></div>}
      {short && <p className="alert" style={{ margin: 0 }}>This is less than {cutoff} hours away, so we’ll treat it as urgent. If it’s really tight, give us a call too.</p>}
      {err && <p className="err">{err}</p>}
      <div className="btnrow" style={{ justifyContent: 'flex-end' }}>
        <button className="btn blue" disabled={pending || !f.siteId}>{pending ? 'Sending…' : dates.length > 1 ? `Send ${dates.length} requests` : 'Send request'}</button>
      </div>
    </form>
  );
}
