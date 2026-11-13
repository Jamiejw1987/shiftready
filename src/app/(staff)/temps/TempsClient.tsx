'use client';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { displayMobile, toE164 } from '@/lib/phone';
import { looksLikePostcode, milesBetween, type Point } from '@/lib/geo';
import { plainText, segmentInfo } from '@/lib/smsText';
import { DEFAULT_WELCOME_MESSAGE, welcomeMessageProblems, isDefaultWelcome, renderWelcomeMessage } from '@/lib/welcomeMessage';
import { JOB_TYPES } from '@/lib/format';
import { parseCSV, mapRows, type MappedRow } from './csv';
import { addTemp, importTemps, setTempStatus, resendWelcome, deleteTemp, sendBulkText, lookupPostcode } from './actions';

export type TempRow = {
  id: string; first_name: string; last_name: string; mobile: string; postcode: string | null;
  lat: number | null; lng: number | null; job_types: string[]; status: 'pending' | 'active' | 'hold' | 'out'; wa_status?: 'unknown' | 'yes' | 'no'; hours_cap?: number | null;
  added_by: string | null; created_at: string;
};
type User = { id: string; full_name: string };

const STATUS: Record<TempRow['status'], [string, string]> = {
  pending: ['warn', 'Awaiting opt-in'], active: ['ok', 'Active'], hold: ['mute', 'On hold'], out: ['bad', 'Opted out'],
};
const TEMPLATES = [
  ['Shifts coming up this week', "Hi {first}, we've got lots of shifts coming up this week near you. Keep an eye on your texts and accept fast to secure a place. - Staff Selection"],
  ['Urgent cover needed', "Hi {first}, we urgently need cover for tomorrow. Keep an eye on your texts for the shift offer. - Staff Selection"],
  ['PPE reminder', 'Hi {first}, quick reminder to bring safety boots and hi-vis to every shift, or you may be sent home unpaid. - Staff Selection'],
  ['Holiday and P45 link', "Hi {first}, you can now request holiday or your P45 from your phone. Keep this link: {link} - Staff Selection"],
  ['Write my own', ''],
];

function areaMatch(pc: string | null, a: string) {
  if (!pc) return false; // no postcode on file (e.g. applied online and not registered yet)
  const out = pc.split(' ')[0].toUpperCase(), full = pc.replace(/\s+/g, '').toUpperCase();
  if (/^[A-Z]+$/.test(a)) return (out.match(/^[A-Z]+/)?.[0] ?? '') === a;
  return out === a || (a.length > out.length && full.startsWith(a));
}

export function TempsClient({ temps, users, me }: { temps: TempRow[]; users: User[]; me: { id: string; name: string; admin: boolean } }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const userName = (id: string | null) => users.find((u) => u.id === id)?.full_name ?? 'Former consultant';

  // ---------- quick add ----------
  const [form, setForm] = useState({ first: '', last: '', mobile: '', postcode: '', types: ['Warehouse'] as string[] });
  const [confirmed, setConfirmed] = useState(false);
  const [addMsg, setAddMsg] = useState<{ ok: boolean; text: string } | null>(null);
  function submitAdd() {
    start(async () => {
      const r = await addTemp(form, confirmed);
      setAddMsg({ ok: r.ok, text: r.ok ? r.message! : r.error! });
      if (r.ok) { setForm({ first: '', last: '', mobile: '', postcode: '', types: ['Warehouse'] }); setConfirmed(false); router.refresh(); }
    });
  }

  // ---------- CSV import ----------
  const [preview, setPreview] = useState<{ name: string; rows: (MappedRow & { issues: string[] })[] } | null>(null);
  const [csvErr, setCsvErr] = useState('');
  const [csvMsg, setCsvMsg] = useState('');
  const [over, setOver] = useState(false);
  // The welcome text for this import, remembered on this computer for next time.
  const [welcome, setWelcomeState] = useState(DEFAULT_WELCOME_MESSAGE);
  useEffect(() => { try { const v = localStorage.getItem('ssuk.welcomeMessage'); if (v) setWelcomeState(v); } catch { /* not available */ } }, []);
  const setWelcome = (t: string) => { setWelcomeState(t); try { localStorage.setItem('ssuk.welcomeMessage', t); } catch { /* not available */ } };
  function loadFile(f: File) {
    setCsvErr(''); setCsvMsg('');
    const r = new FileReader();
    r.onload = () => {
      const m = mapRows(parseCSV(String(r.result)));
      if (m.error) { setPreview(null); return setCsvErr(m.error); }
      const known = new Set(temps.map((t) => t.mobile));
      const seen = new Set<string>();
      setPreview({
        name: f.name,
        rows: m.rows!.map((row) => {
          const issues: string[] = []; const e = toE164(row.mobile);
          if (!row.first) issues.push('No name');
          if (!e) issues.push('Mobile not valid');
          else if (known.has(e)) issues.push('Already on list');
          else if (seen.has(e)) issues.push('Duplicate in file');
          if (!looksLikePostcode(row.postcode)) issues.push('Postcode missing or invalid');
          if (e) seen.add(e);
          return { ...row, issues };
        }),
      });
    };
    r.readAsText(f);
  }
  function runImport() {
    if (!preview) return;
    const good = preview.rows.filter((r) => !r.issues.length);
    start(async () => {
      const r = await importTemps(good.map(({ first, last, mobile, postcode, types }) => ({ first, last, mobile, postcode, types })), welcome);
      if (!r.ok) return setCsvErr(r.error!);
      setPreview(null);
      setCsvMsg(r.message! + (r.skipped?.length ? ` ${r.skipped.length} more skipped: ${r.skipped.slice(0, 5).map((s) => `row ${s.row} (${s.reason})`).join(', ')}${r.skipped.length > 5 ? '…' : ''}` : ''));
      router.refresh();
    });
  }

  // ---------- filters ----------
  const [q, setQ] = useState('');
  const [area, setArea] = useState('');
  const [near, setNear] = useState('');
  const [nearPoint, setNearPoint] = useState<Point | null>(null);
  const [nearErr, setNearErr] = useState('');
  const [miles, setMiles] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [by, setBy] = useState('all');
  async function findNear() {
    setNearErr('');
    if (!near.trim()) return setNearPoint(null);
    const p = await lookupPostcode(near);
    if (!p) { setNearPoint(null); return setNearErr('Postcode not found'); }
    setNearPoint(p);
    if (!miles) setMiles('10');
  }
  const dist = (t: TempRow) => (nearPoint && t.lat != null && t.lng != null ? milesBetween(nearPoint, { lat: t.lat, lng: t.lng }) : null);
  const shown = useMemo(() => {
    const a = area.trim().toUpperCase().replace(/\s+/g, ''), mi = parseFloat(miles);
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const digits = q.replace(/\D/g, '');
    return temps.filter((t) => {
      if (words.length) {
        const name = `${t.first_name} ${t.last_name}`.toLowerCase();
        const mob = displayMobile(t.mobile).replace(/\D/g, '');
        const byName = words.every((w) => name.includes(w));
        const byMobile = digits.length >= 4 && mob.includes(digits.replace(/^44/, '0'));
        if (!byName && !byMobile) return false;
      }
      if (a && !areaMatch(t.postcode, a)) return false;
      if (nearPoint && mi) { const d = dist(t); if (d == null || d > mi) return false; }
      if (type && !(t.job_types ?? []).includes(type)) return false;
      if (status && t.status !== status) return false;
      if (by !== 'all' && t.added_by !== by) return false;
      return true;
    }).sort((x, y) => (nearPoint ? (dist(x) ?? 999) - (dist(y) ?? 999) : 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [temps, q, area, nearPoint, miles, type, status, by]);
  // Show the latest 10 until someone searches or filters, then up to 50 at a time.
  const filtering = Boolean(q.trim() || area.trim() || (nearPoint && miles) || type || status || by !== 'all');
  const [limit, setLimit] = useState(10);
  useEffect(() => setLimit(filtering ? 50 : 10), [filtering, q, area, nearPoint, miles, type, status, by]);
  const visible = shown.slice(0, limit);
  function clearFilters() { setQ(''); setArea(''); setNear(''); setNearPoint(null); setMiles(''); setType(''); setStatus(''); setBy('all'); }

  // ---------- selection & bulk text ----------
  const [sel, setSel] = useState<Set<string>>(new Set());
  const allShown = shown.length > 0 && shown.every((t) => sel.has(t.id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSel((s) => { const n = new Set(s); shown.forEach((t) => (allShown ? n.delete(t.id) : n.add(t.id))); return n; });
  const [compose, setCompose] = useState(false);
  const [body, setBody] = useState('');
  const [bulkMsg, setBulkMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const recipients = temps.filter((t) => sel.has(t.id) && t.status === 'active');
  const skipped = sel.size - recipients.length;
  const seg = segmentInfo(plainText(body.replace(/\{first\}/g, 'Christopher').replace(/\{link\}/g, 'https://shiftready-tan.vercel.app/me/00000000-0000-0000-0000-000000000000')));
  function sendBulk() {
    start(async () => {
      const r = await sendBulkText(recipients.map((t) => t.id), body);
      setBulkMsg({ ok: r.ok, text: r.ok ? r.message! : r.error! });
      if (r.ok) { setCompose(false); setBody(''); setSel(new Set()); router.refresh(); }
    });
  }

  // ---------- row actions ----------
  const [rowErr, setRowErr] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  function rowAction(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setRowErr('');
    start(async () => { const r = await fn(); if (!r.ok) setRowErr(r.error!); setConfirmDelete(null); router.refresh(); });
  }

  const typeChip = (list: string[], set: (v: string[]) => void, t: string) => (
    <label className="chip" key={t}>
      <input type="checkbox" checked={list.includes(t)} onChange={(e) => set(e.target.checked ? [...list, t] : list.filter((x) => x !== t))} /> {t}
    </label>
  );

  return (
    <>
      <section className="panel">
        <h1>Add an existing temp</h1>
        <p className="lede">For temps who are already fully compliant with you. New candidates should register through <a href="/registrations">Sign-ups</a> instead. Existing temps get a welcome text and must opt in before they receive shifts.</p>
        <div className="form">
          <div className="f"><label className="l" htmlFor="aFirst">First name</label><input id="aFirst" type="text" value={form.first} onChange={(e) => setForm({ ...form, first: e.target.value })} /></div>
          <div className="f"><label className="l" htmlFor="aLast">Surname</label><input id="aLast" type="text" value={form.last} onChange={(e) => setForm({ ...form, last: e.target.value })} /></div>
          <div className="f"><label className="l" htmlFor="aMob">Mobile</label><input id="aMob" type="tel" placeholder="07…" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} /></div>
          <div className="f"><label className="l" htmlFor="aPc">Postcode</label><input id="aPc" type="text" placeholder="BD4 7XX" value={form.postcode} onChange={(e) => setForm({ ...form, postcode: e.target.value })} /></div>
          <div className="f w4"><span className="l">Cleared for</span>
            <div className="chips">{JOB_TYPES.map((t) => typeChip(form.types, (v) => setForm({ ...form, types: v }), t))}</div></div>
        </div>
        <div className="bar">
          {addMsg ? <p className={addMsg.ok ? 'okmsg' : 'err'}>{addMsg.text}</p> : <span />}
          <div className="btnrow" style={{ alignItems: 'center' }}>
            <label className="chip"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> Already fully compliant</label>
            <button className="btn blue" onClick={submitAdd} disabled={pending}>Add temp and send welcome text</button>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Bulk add existing temps</h2>
        <p className="lede">Upload a CSV of temps who are already compliant (for example an export from KISREC). Columns needed: first name, surname, mobile, postcode. Job types is optional.</p>
        <div className={over ? 'drop over' : 'drop'}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) loadFile(f); }}>
          <div className="btnrow">
            <label className="btn ghost" htmlFor="csvFile">Choose CSV file</label>
            <input id="csvFile" type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ''; }} />
          </div>
          <span className="note">Or drag a CSV file onto this box.</span>
        </div>
        {csvErr && <p className="err" style={{ marginTop: 10 }}>{csvErr}</p>}
        {csvMsg && <p className="okmsg" style={{ marginTop: 10 }}>{csvMsg}</p>}
        {preview && (() => {
          const good = preview.rows.filter((r) => !r.issues.length).length, bad = preview.rows.length - good;
          return (
            <>
              <div className="summary"><span className="pill mute">{preview.name}</span><span className="pill ok">{good} ready to add</span>{bad > 0 && <span className="pill bad">{bad} need fixing</span>}</div>
              <div className="tablewrap"><table className="cards"><thead><tr><th>Temp</th><th>Mobile</th><th>Postcode</th><th>Cleared for</th><th>Check</th></tr></thead><tbody>
                {preview.rows.map((r, i) => (
                  <tr key={i} className={r.issues.length ? 'bad' : ''}>
                    <td>{r.first} {r.last}</td><td className="num" data-l="Mobile">{r.mobile || '-'}</td><td className="mono" data-l="Postcode">{r.postcode || '-'}</td>
                    <td className="full">{r.types.join(', ')}</td>
                    <td>{r.issues.length ? <span className="err">{r.issues.join('; ')}</span> : <span className="pill ok">OK</span>}</td>
                  </tr>))}
              </tbody></table></div>
              {(() => {
                const sample = preview.rows.find((r) => !r.issues.length)?.first || 'Sarah';
                const shown = renderWelcomeMessage(welcome, { first: sample, token: '00000000-0000-0000-0000-000000000000' }, typeof window !== 'undefined' ? window.location.origin : '');
                const seg = segmentInfo(plainText(shown));
                const problems = welcomeMessageProblems(welcome);
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
                    <div className="btnrow">
                      <span className="note">Welcome message:</span>
                      <button type="button" className={`chip${isDefaultWelcome(welcome) ? ' on' : ''}`} onClick={() => setWelcome(DEFAULT_WELCOME_MESSAGE)}>Standard welcome</button>
                    </div>
                    <label className="f"><span className="l">Text they’ll get</span>
                      <textarea rows={4} value={welcome} onChange={(e) => setWelcome(e.target.value)} /></label>
                    <p className="note" style={{ margin: 0 }}><b>{'{first}'}</b> = their first name, <b>{'{link}'}</b> = their link to opt in to shift offers. Keep “Reply YES” in so they can opt in by text.</p>
                    <div className="f"><span className="l">How it looks</span>
                      <div className="secret" style={{ fontFamily: 'var(--f-body)', fontSize: 14 }}>{shown}</div>
                      <span className="note">{seg.chars} characters, {seg.segments} text{seg.segments === 1 ? '' : 's'} each{seg.unicode ? ' (a special character makes each text shorter: check for curly quotes or emoji)' : ''}.{!isDefaultWelcome(welcome) ? ' A changed message goes by text, not WhatsApp.' : ''}</span></div>
                    {problems.length > 0 && <p className="alert" style={{ margin: 0 }}>{problems.join('. ')}.</p>}
                  </div>
                );
              })()}
              <div className="bar"><span className="note">Rows with problems are skipped. Fix them in the file and re-upload.</span>
                <div className="btnrow"><button className="btn ghost" onClick={() => setPreview(null)}>Cancel</button>
                  <button className="btn blue" disabled={!good || pending || welcomeMessageProblems(welcome).length > 0} onClick={runImport}>{pending ? 'Adding…' : `Add ${good} temps and send welcome texts`}</button></div></div>
            </>
          );
        })()}
      </section>

      <section className="panel">
        <h2>Temp list</h2>
        <p className="lede">Only temps marked Active receive shift offers and texts.</p>
        <div className="f" style={{ marginBottom: 12 }}>
          <label className="l" htmlFor="fQ">Search</label>
          <input id="fQ" type="search" placeholder="Name or mobile, e.g. Dan Smith or 07700" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        </div>
        <div className="filters">
          <div className="f"><label className="l" htmlFor="fArea">Postcode or area</label><input id="fArea" type="text" placeholder="e.g. BD4, BD, LS" value={area} onChange={(e) => setArea(e.target.value)} /></div>
          <div className="f"><label className="l" htmlFor="fNear">Near postcode</label>
            <input id="fNear" type="text" placeholder="e.g. BD4 6SG" value={near} onChange={(e) => setNear(e.target.value)} onBlur={findNear} onKeyDown={(e) => e.key === 'Enter' && findNear()} />
            {nearErr && <span className="err">{nearErr}</span>}</div>
          <div className="f"><label className="l" htmlFor="fMiles">Within</label>
            <select id="fMiles" value={miles} onChange={(e) => setMiles(e.target.value)} disabled={!nearPoint}>
              <option value="">Any distance</option>{[5, 10, 15, 25].map((m) => <option key={m} value={m}>{m} miles</option>)}</select></div>
          <div className="f"><label className="l" htmlFor="fType">Cleared for</label>
            <select id="fType" value={type} onChange={(e) => setType(e.target.value)}><option value="">Any job type</option>{JOB_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
          <div className="f"><label className="l" htmlFor="fStatus">Status</label>
            <select id="fStatus" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>
              {Object.entries(STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div className="f"><label className="l" htmlFor="fBy">Added by</label>
            <select id="fBy" value={by} onChange={(e) => setBy(e.target.value)}><option value="all">Everyone</option><option value={me.id}>Me</option>
              {users.filter((u) => u.id !== me.id).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></div>
        </div>

        <div className="selbar">
          <span><b>{filtering ? `${shown.length} match${shown.length === 1 ? '' : 'es'}` : `Latest ${visible.length} of ${temps.length}`}</b> <span className="note">{sel.size ? `· ${sel.size} selected` : filtering ? '· tick temps, or the top box to select every match' : '· search or filter to find anyone else'}</span></span>
          <div className="btnrow">
            <button className="btn small" style={{ background: 'transparent', border: '1px solid #3a414c' }} onClick={clearFilters}>Clear filters</button>
            <button className="btn blue small" disabled={!sel.size} onClick={() => { setCompose(true); setBulkMsg(null); if (!body) setBody(TEMPLATES[0][1]); }}>Text selected{sel.size ? ` (${sel.size})` : ''}</button>
          </div>
        </div>
        {bulkMsg && <p className={bulkMsg.ok ? 'okmsg' : 'err'} style={{ marginBottom: 10 }}>{bulkMsg.text}</p>}

        {compose && (
          <div className="compose">
            <h3 style={{ margin: 0 }}>Bulk text</h3>
            <div className="f"><label className="l" htmlFor="tpl">Template</label>
              <select id="tpl" onChange={(e) => setBody(TEMPLATES[+e.target.value][1])}>{TEMPLATES.map(([l], i) => <option key={l} value={i}>{l}</option>)}</select></div>
            <div className="f"><label className="l" htmlFor="msgBody">Message <span className="note">{'{first}'} becomes each temp’s first name, {'{link}'} their own holiday/P45 link</span></label>
              <textarea id="msgBody" value={body} onChange={(e) => setBody(e.target.value)} style={{ minHeight: 110 }} />
              <span className="counter">{seg.chars} characters · {seg.segments} text{seg.segments > 1 ? 's' : ''} per person{seg.unicode ? ' · contains special characters or emoji, which make texts shorter and cost more' : ''}</span></div>
            <p className="note" style={{ margin: 0 }}>Goes to <b>{recipients.length}</b> active temp{recipients.length === 1 ? '' : 's'} (about {recipients.length * seg.segments} texts).
              {skipped > 0 && ` ${skipped} not sent: awaiting opt-in, on hold or opted out. We can only text people who’ve opted in.`}</p>
            <div className="btnrow" style={{ justifyContent: 'flex-end' }}>
              <button className="btn ghost" onClick={() => setCompose(false)}>Cancel</button>
              <button className="btn blue" disabled={!recipients.length || !body.trim() || pending} onClick={sendBulk}>{pending ? 'Sending…' : `Send to ${recipients.length}`}</button>
            </div>
          </div>
        )}
        {rowErr && <p className="err" style={{ marginBottom: 10 }}>{rowErr}</p>}

        <div className="tablewrap"><table className="cards">
          <thead><tr>
            <th className="sel"><input type="checkbox" className="rowsel" checked={allShown} onChange={toggleAll} aria-label="Select every match" /></th>
            <th>Temp</th><th>Mobile</th><th>Postcode</th>{nearPoint && <th>Miles</th>}<th>Cleared for</th><th>Status</th><th>Added by</th><th></th></tr></thead>
          <tbody>
            {visible.map((t) => {
              const [k, l] = STATUS[t.status]; const d = dist(t);
              return (
                <tr key={t.id}>
                  <td className="sel"><input type="checkbox" className="rowsel" checked={sel.has(t.id)} onChange={() => toggle(t.id)} aria-label={`Select ${t.first_name} ${t.last_name}`} /></td>
                  <td><a href={`/temps/${t.id}`}><b>{t.first_name} {t.last_name}</b></a></td>
                  <td className="num" data-l="Mobile">{displayMobile(t.mobile)}</td>
                  <td className="mono" data-l="Postcode">{t.postcode}</td>
                  {nearPoint && <td className="num" data-l="Miles">{d != null ? d.toFixed(1) : '-'}</td>}
                  <td className="full">{(t.job_types ?? []).map((x) => <span key={x} className="pill blue" style={{ marginRight: 4 }}>{x}</span>)}</td>
                  <td><span className={`pill ${k}`}>{l}</span>{t.wa_status === 'yes' && <span className="pill wa" title="Gets messages on WhatsApp" style={{ marginLeft: 4 }}>WhatsApp</span>}{t.hours_cap != null && <span className="pill warn" title="Can't be booked over this many hours a week" style={{ marginLeft: 4 }}>Max {t.hours_cap}h/wk</span>}</td>
                  <td className="by" data-l="Added by">{userName(t.added_by)}<small>{new Date(t.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</small></td>
                  <td>
                    <div className="btnrow">
                      {t.status === 'active' && <button className="btn ghost small" disabled={pending} onClick={() => rowAction(() => setTempStatus(t.id, 'hold'))}>Put on hold</button>}
                      {t.status === 'hold' && <button className="btn ghost small" disabled={pending} onClick={() => rowAction(() => setTempStatus(t.id, 'active'))}>Reactivate</button>}
                      {t.status === 'pending' && <button className="btn ghost small" disabled={pending} onClick={() => rowAction(() => resendWelcome(t.id))}>Resend welcome</button>}
                      {me.admin && (confirmDelete === t.id
                        ? <><button className="btn small" style={{ background: 'var(--bad)' }} onClick={() => rowAction(() => deleteTemp(t.id))}>Confirm delete</button><button className="btn ghost small" onClick={() => setConfirmDelete(null)}>Keep</button></>
                        : <button className="btn ghost small" onClick={() => setConfirmDelete(t.id)}>Delete</button>)}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!shown.length && <tr><td colSpan={9} className="note">{temps.length ? 'No temps match these filters.' : 'No temps yet. Send registration links from Sign-ups, or add existing temps above.'}</td></tr>}
          </tbody>
        </table></div>
        {shown.length > visible.length && (
          <div className="btnrow" style={{ justifyContent: 'center', marginTop: 12 }}>
            <span className="note">Showing {visible.length} of {shown.length}{filtering ? '' : ' temps'}</span>
            <button className="btn ghost small" onClick={() => setLimit((n) => n + 50)}>Show 50 more</button>
            {!filtering && <span className="note">or use Search to find someone</span>}
          </div>
        )}
      </section>
    </>
  );
}
