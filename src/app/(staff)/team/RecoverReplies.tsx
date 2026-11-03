'use client';
import { useState, useTransition } from 'react';
import { recoverReplies } from './actions';

type Row = { at: string; from: string; name: string | null; body: string };

/** Admin tool: pull replies from Twilio that never reached ShiftReady and handle them now. */
export function RecoverReplies() {
  const yesterday = new Date(Date.now() - 864e5);
  yesterday.setHours(17, 0, 0, 0);
  const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
  const [since, setSince] = useState(local(yesterday));
  const [pending, start] = useTransition();
  const [res, setRes] = useState<{ ok: boolean; error?: string; found?: number; alreadyHad?: number; recovered?: Row[] } | null>(null);
  const t = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <section className="panel">
      <h2>Recover missed replies</h2>
      <p className="lede">If texts or WhatsApp replies didn’t reach ShiftReady (for example while the Twilio link was broken), this fetches every reply Twilio received since the time below and handles them now, oldest first: accepts, declines, confirmations, opt-ins and requests. Temps get the usual reply texted back. Replies ShiftReady already has are skipped, so it’s safe to run more than once.</p>
      <div className="btnrow" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <label className="note">Replies since <input type="datetime-local" value={since} onChange={(e) => setSince(e.target.value)} /></label>
        <button className="btn blue" disabled={pending} onClick={() => start(async () => { setRes(null); setRes(await recoverReplies(new Date(since).toISOString())); })}>
          {pending ? 'Recovering… (can take a minute or two)' : 'Recover missed replies'}
        </button>
      </div>
      {res && !res.ok && <p className="err">{res.error}</p>}
      {res?.ok && (
        <>
          <p className="okmsg">Found {res.found} replies in Twilio. {res.alreadyHad} were already in ShiftReady. Recovered {res.recovered?.length ?? 0}. Shift boards are now up to date.</p>
          {!!res.recovered?.length && (
            <div className="tablewrap"><table className="cards">
              <thead><tr><th>Received</th><th>From</th><th>Reply</th></tr></thead>
              <tbody>
                {res.recovered.map((r, i) => (
                  <tr key={i}>
                    <td className="mono" data-l="Received">{t(r.at)}</td>
                    <td data-l="From"><b>{r.name ?? 'Unknown number'}</b><br /><span className="note">{r.from}</span></td>
                    <td className="full">{r.body}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </>
      )}
    </section>
  );
}
