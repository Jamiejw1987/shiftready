'use client';
import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { displayMobile } from '@/lib/phone';
import { setMessagesOff, addOngoing, endOngoing, findWorkers } from './actions';

type Msg = { ok: boolean; text: string } | null;
const Note = ({ m }: { m: Msg }) => (m ? <p className={m.ok ? 'okmsg' : 'err'} style={{ marginTop: 10 }}>{m.text}</p> : null);
const todayUK = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
export const niceDate = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
export const since = (d: string) => {
  const w = Math.floor((Date.parse(todayUK() + 'T12:00:00Z') - Date.parse(d + 'T12:00:00Z')) / (7 * 864e5));
  return w < 1 ? 'under a week' : w < 9 ? `${w} week${w === 1 ? '' : 's'}` : `${Math.floor(w / 4.345)} months`;
};

export type Assignment = {
  id: string; client_id: string; client_name: string; site_name: string | null; temp_id: string; temp_name: string; mobile?: string;
  job_title: string | null; start_date: string; end_date: string | null; notes: string | null;
};
export type ClientOption = { id: string; name: string; sites: { id: string; name: string }[] };

const REASON: Record<string, string> = {
  ongoing: 'ongoing at a client', imported: 'imported from another system', manual: 'switched off by hand',
};

/** The "No messages" banner and button at the top of a worker's record. */
export function MessagesSwitch({ tempId, firstName, off, reason }: { tempId: string; firstName: string; off: boolean; reason: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const run = (v: boolean) => start(async () => { const r = await setMessagesOff(tempId, v); setMsg({ ok: r.ok, text: r.ok ? r.message! : r.error! }); router.refresh(); });
  return (
    <div className={off ? 'optback' : undefined} style={{ marginTop: 12 }}>
      {off ? (
        <>
          <p style={{ margin: 0 }}><b>Messages off</b>{reason && REASON[reason] ? ` (${REASON[reason]})` : ''}. {firstName} gets nothing from ShiftReady: no shift offers, reminders, links, texts or emails.</p>
          <div className="btnrow" style={{ marginTop: 10 }}>
            <button className="btn ghost small" disabled={pending} onClick={() => {
              if (confirm(`Switch messages back on for ${firstName}? They'll start getting texts from ShiftReady again.`)) run(false);
            }}>Switch messages back on</button>
          </div>
        </>
      ) : (
        <div className="btnrow">
          <button className="btn ghost small" disabled={pending} onClick={() => run(true)}>No messages (ongoing worker)</button>
          <span className="note">Stops every text, offer and email to {firstName}.</span>
        </div>
      )}
      <Note m={msg} />
    </div>
  );
}

function EndButton({ a, label = 'End' }: { a: Assignment; label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [end, setEnd] = useState(todayUK());
  const [backOn, setBackOn] = useState(false);
  const [err, setErr] = useState('');
  if (!open) return <button className="btn ghost small" onClick={() => setOpen(true)}>{label}</button>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
      <label className="note">Last day <input type="date" value={end} min={a.start_date} onChange={(e) => setEnd(e.target.value)} /></label>
      <label className="chip"><input type="checkbox" checked={backOn} onChange={(e) => setBackOn(e.target.checked)} /> Switch messages back on</label>
      <div className="btnrow">
        <button className="btn ghost small" onClick={() => setOpen(false)}>Cancel</button>
        <button className="btn blue small" disabled={pending} onClick={() => start(async () => {
          const r = await endOngoing(a.id, { endDate: end, messagesBackOn: backOn });
          if (!r.ok) return setErr(r.error!);
          setOpen(false); router.refresh();
        })}>End at {a.client_name}</button>
      </div>
      {err && <span className="err">{err}</span>}
    </div>
  );
}

/** On a worker's record: where they're working ongoing, and adding them to a client. */
export function WorkerOngoing({ tempId, firstName, list, clients }: { tempId: string; firstName: string; list: Assignment[]; clients: ClientOption[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ clientId: '', siteId: '', startDate: todayUK(), jobTitle: '' });
  const [msg, setMsg] = useState<Msg>(null);
  const current = list.filter((a) => !a.end_date || a.end_date >= todayUK());
  const past = list.filter((a) => a.end_date && a.end_date < todayUK());
  const sites = clients.find((c) => c.id === f.clientId)?.sites ?? [];
  return (
    <>
      <div className="tablewrap"><table>
        <tbody>
          {current.map((a) => (
            <tr key={a.id}>
              <td><Link href={`/clients/${a.client_id}`}><b>{a.client_name}</b></Link>{a.site_name && ` · ${a.site_name}`}{a.job_title && <div className="note">{a.job_title}</div>}
                <div className="note">Since {niceDate(a.start_date)} ({since(a.start_date)}){a.end_date ? ` · finishing ${niceDate(a.end_date)}` : ' · no end date'}</div></td>
              <td style={{ textAlign: 'right' }}>{!a.end_date && <EndButton a={a} />}</td>
            </tr>
          ))}
          {past.map((a) => (
            <tr key={a.id} style={{ opacity: 0.6 }}>
              <td><Link href={`/clients/${a.client_id}`}>{a.client_name}</Link>{a.site_name && ` · ${a.site_name}`}<div className="note">{niceDate(a.start_date)} to {niceDate(a.end_date!)}</div></td>
              <td style={{ textAlign: 'right' }}><span className="pill mute">Ended</span></td>
            </tr>
          ))}
          {!list.length && <tr><td className="note">Not working ongoing anywhere. Add {firstName} to a client if they work there week in, week out.</td></tr>}
        </tbody>
      </table></div>
      {!open ? (
        <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => { setOpen(true); setMsg(null); }}>Add as ongoing at a client</button>
      ) : (
        <div className="compose" style={{ marginTop: 12, marginBottom: 0 }}>
          <div className="form">
            <div className="f w2"><label className="l" htmlFor="ogClient">Client</label>
              <select id="ogClient" value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value, siteId: '' })}>
                <option value="">Choose a client</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              {!clients.length && <span className="note">No clients yet. Add one on the Clients page first.</span>}</div>
            <div className="f w2"><label className="l" htmlFor="ogSite">Site (optional)</label>
              <select id="ogSite" value={f.siteId} disabled={!sites.length} onChange={(e) => setF({ ...f, siteId: e.target.value })}>
                <option value="">{sites.length ? 'Any / not sure' : 'No sites'}</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            <div className="f w2"><label className="l" htmlFor="ogStart">Started</label><input id="ogStart" type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></div>
            <div className="f w2"><label className="l" htmlFor="ogJob">Role (optional)</label><input id="ogJob" type="text" placeholder="e.g. Picker, nights" value={f.jobTitle} onChange={(e) => setF({ ...f, jobTitle: e.target.value })} /></div>
          </div>
          <p className="note" style={{ margin: 0 }}>No end date needed. They stay ongoing until you press End. Their messages switch off as soon as you save.</p>
          <div className="btnrow" style={{ justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn blue" disabled={pending || !f.clientId} onClick={() => start(async () => {
              const r = await addOngoing({ tempId, ...f });
              setMsg({ ok: r.ok, text: r.ok ? r.message! : r.error! });
              if (r.ok) { setOpen(false); setF({ clientId: '', siteId: '', startDate: todayUK(), jobTitle: '' }); router.refresh(); }
            })}>Save</button>
          </div>
        </div>
      )}
      <Note m={msg} />
    </>
  );
}

type Found = { id: string; first_name: string; last_name: string; mobile: string; postcode: string | null; status: string };

/** On a client's page: everyone working there ongoing, and adding more. */
export function ClientOngoing({ clientId, clientName, sites, current, past }: { clientId: string; clientName: string; sites: { id: string; name: string }[]; current: Assignment[]; past: Assignment[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found[]>([]);
  const [pick, setPick] = useState<Found | null>(null);
  const [f, setF] = useState({ siteId: '', startDate: todayUK(), jobTitle: '' });
  const [msg, setMsg] = useState<Msg>(null);
  const [showPast, setShowPast] = useState(false);
  useEffect(() => {
    if (pick || q.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(() => findWorkers(q).then(setFound).catch(() => setFound([])), 300);
    return () => clearTimeout(t);
  }, [q, pick]);
  const onHere = new Set(current.filter((a) => !a.end_date).map((a) => a.temp_id));
  return (
    <>
      <div className="tablewrap"><table className="cards">
        <thead><tr><th>Worker</th><th>Site</th><th>Role</th><th>Started</th><th></th></tr></thead>
        <tbody>
          {current.map((a) => (
            <tr key={a.id}>
              <td><Link href={`/temps/${a.temp_id}`}><b>{a.temp_name}</b></Link>{a.mobile && <div className="mono note">{displayMobile(a.mobile)}</div>}</td>
              <td data-l="Site">{a.site_name || '-'}</td>
              <td data-l="Role">{a.job_title || '-'}</td>
              <td data-l="Started">{niceDate(a.start_date)}<div className="note">{since(a.start_date)}{a.end_date ? ` · finishing ${niceDate(a.end_date)}` : ''}</div></td>
              <td style={{ textAlign: 'right' }}>{!a.end_date && <EndButton a={a} />}</td>
            </tr>
          ))}
          {!current.length && <tr><td colSpan={5} className="note">Nobody down as ongoing here yet.</td></tr>}
        </tbody>
      </table></div>
      {past.length > 0 && (
        <>
          <button className="btn ghost small" style={{ marginTop: 8 }} onClick={() => setShowPast(!showPast)}>{showPast ? 'Hide' : 'Show'} {past.length} who’ve finished</button>
          {showPast && <div className="tablewrap" style={{ marginTop: 8 }}><table><tbody>
            {past.map((a) => <tr key={a.id} style={{ opacity: 0.65 }}><td><Link href={`/temps/${a.temp_id}`}>{a.temp_name}</Link>{a.site_name && ` · ${a.site_name}`}</td><td className="note" style={{ textAlign: 'right' }}>{niceDate(a.start_date)} to {niceDate(a.end_date!)}</td></tr>)}
          </tbody></table></div>}
        </>
      )}

      <div className="compose" style={{ marginTop: 14, marginBottom: 0 }}>
        <h3 style={{ margin: 0 }}>Add an ongoing worker</h3>
        {!pick ? (
          <div className="f"><label className="l" htmlFor="ogFind">Find worker</label>
            <input id="ogFind" type="search" autoComplete="off" placeholder="Name or mobile" value={q} onChange={(e) => setQ(e.target.value)} />
            {found.length > 0 && (
              <div className="tablewrap" style={{ marginTop: 6 }}><table><tbody>
                {found.map((t) => (
                  <tr key={t.id}><td><b>{t.first_name} {t.last_name}</b> <span className="note">{displayMobile(t.mobile)}{t.postcode ? ` · ${t.postcode}` : ''}</span></td>
                    <td style={{ textAlign: 'right' }}>{onHere.has(t.id) ? <span className="pill ok">Already here</span> : <button className="btn ghost small" onClick={() => { setPick(t); setMsg(null); }}>Choose</button>}</td></tr>
                ))}
              </tbody></table></div>
            )}
            {q.trim().length >= 2 && !found.length && <span className="note">No match yet. Workers not on ShiftReady can be brought in with Import workers on the Temps page.</span>}
          </div>
        ) : (
          <>
            <p style={{ margin: 0 }}><b>{pick.first_name} {pick.last_name}</b> <button className="btn ghost small" onClick={() => { setPick(null); setQ(''); }}>Change</button></p>
            <div className="form">
              <div className="f w2"><label className="l" htmlFor="ogSite2">Site (optional)</label>
                <select id="ogSite2" value={f.siteId} disabled={!sites.length} onChange={(e) => setF({ ...f, siteId: e.target.value })}>
                  <option value="">{sites.length ? 'Any / not sure' : 'No sites'}</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div className="f w2"><label className="l" htmlFor="ogStart2">Started</label><input id="ogStart2" type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></div>
              <div className="f w4"><label className="l" htmlFor="ogJob2">Role (optional)</label><input id="ogJob2" type="text" placeholder="e.g. Picker, nights" value={f.jobTitle} onChange={(e) => setF({ ...f, jobTitle: e.target.value })} /></div>
            </div>
            <div className="btnrow" style={{ justifyContent: 'flex-end' }}>
              <span className="note">No end date needed. Their messages switch off when you save.</span>
              <button className="btn blue" disabled={pending} onClick={() => start(async () => {
                const r = await addOngoing({ tempId: pick.id, clientId, ...f });
                setMsg({ ok: r.ok, text: r.ok ? r.message! : r.error! });
                if (r.ok) { setPick(null); setQ(''); setF({ siteId: '', startDate: todayUK(), jobTitle: '' }); router.refresh(); }
              })}>Add to {clientName}</button>
            </div>
          </>
        )}
        <Note m={msg} />
      </div>
    </>
  );
}
