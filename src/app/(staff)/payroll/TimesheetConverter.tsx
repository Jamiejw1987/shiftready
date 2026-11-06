'use client';
import { useState, useTransition } from 'react';
import { checkTimesheets, downloadTimesheets } from './actions';
import type { ConvertResult, MatchRow } from '@/lib/timesheets';

const hoursText = (r: MatchRow) => r.lines.map((l) => `${l.hours}h @ £${l.rate.toFixed(2)}`).join(' + ') || 'No hours';

function readB64(file: File): Promise<string> {
  return new Promise((ok, fail) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result).split(',')[1] ?? '');
    fr.onerror = () => fail(fr.error);
    fr.readAsDataURL(file);
  });
}

export function TimesheetConverter() {
  const [file, setFile] = useState<{ name: string; b64: string } | null>(null);
  const [res, setRes] = useState<ConvertResult | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  async function pickFile(f: File | undefined) {
    setRes(null); setMsg(null); setChoices({});
    if (!f) return setFile(null);
    setFile({ name: f.name, b64: await readB64(f) });
  }

  function check() {
    if (!file) return;
    setMsg(null);
    start(async () => {
      const r = await checkTimesheets(file.b64);
      if (!r.ok) { setRes(null); return setMsg({ ok: false, text: r.error! }); }
      setRes(r.result!); setChoices({});
    });
  }

  function download() {
    if (!file || !res) return;
    setMsg(null);
    start(async () => {
      const r = await downloadTimesheets(file.b64, choices);
      if (!r.ok) return setMsg({ ok: false, text: r.error! });
      const bytes = Uint8Array.from(atob(r.file!), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a');
      a.href = url; a.download = r.name!;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setMsg({ ok: true, text: `Downloaded ${r.count} ${r.count === 1 ? 'person' : 'people'}${r.missing ? `. ${r.missing} without an NI number, so fill those in by hand` : ''}. Keep the file safe and delete it once payroll is done.` });
    });
  }

  const check_ = res?.rows.filter((r) => r.status === 'check') ?? [];
  const none = res?.rows.filter((r) => r.status === 'none') ?? [];
  const matched = res?.rows.filter((r) => r.status === 'matched') ?? [];
  const unresolved = check_.filter((r) => !choices[r.key]).length;
  const choose = (key: string, v: string) => setChoices((c) => ({ ...c, [key]: v }));

  const picker = (r: MatchRow, blankLabel: string) => (
    <select value={choices[r.key] ?? (r.status === 'none' ? 'none' : '')} onChange={(e) => choose(r.key, e.target.value)} style={{ maxWidth: 280 }}>
      {r.status === 'check' && <option value="" disabled>Choose…</option>}
      {r.suggestions.map((s) => <option key={s.id} value={s.id}>{s.name}{s.hasNi ? '' : ' (no NI on file)'}</option>)}
      <option value="none">{blankLabel}</option>
    </select>
  );

  return (
    <section className="panel">
      <h2>Convert a client timesheet</h2>
      <p className="note" style={{ marginTop: 0 }}>Upload the weekly timesheet export (e.g. InPost). We combine each worker’s timesheets, group their hours by pay rate, look up their NI number in ShiftReady and give you the payroll sheet in our layout, grouped by site.</p>
      <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => pickFile(e.target.files?.[0])} />
      <div className="btnrow" style={{ marginTop: 12 }}>
        <button className="btn blue" disabled={pending || !file} onClick={check}>{pending && !res ? 'Checking…' : 'Check file'}</button>
        {res && <button className="btn" disabled={pending || unresolved > 0} onClick={download}>{pending ? 'Working…' : 'Download payroll sheet'}</button>}
        {res && unresolved > 0 && <span className="note">Choose who {unresolved === 1 ? '1 person is' : `${unresolved} people are`} below first.</span>}
      </div>
      {msg && <p className={msg.ok ? 'ok' : 'err'}>{msg.text}</p>}

      {res && (
        <div style={{ marginTop: 18, display: 'grid', gap: 18 }}>
          <p className="note" style={{ margin: 0 }}>
            <b>{res.client || 'Timesheets'}</b>{res.weekEnding && <> · week ending {res.weekEnding}</>} · {res.timesheets} timesheets → {res.rows.length} people · {matched.length} matched
          </p>
          {res.warnings.map((w, i) => <p key={i} className="err" style={{ margin: 0 }}>{w}</p>)}

          {check_.length > 0 && (
            <div>
              <h3 style={{ margin: '0 0 8px' }}>Needs checking ({check_.length})</h3>
              <div className="tablewrap"><table className="cards"><thead><tr><th>Name in timesheet</th><th>Site</th><th>Hours</th><th>Who is it?</th></tr></thead><tbody>
                {check_.map((r) => <tr key={r.key}>
                  <td><b>{r.fileName}</b><div className="note">{r.reason}</div></td>
                  <td data-l="Site">{r.site}</td>
                  <td data-l="Hours" className="mono">{hoursText(r)}</td>
                  <td data-l="Who is it?">{picker(r, 'None of these – leave NI blank')}</td>
                </tr>)}
              </tbody></table></div>
            </div>
          )}

          {none.length > 0 && (
            <div>
              <h3 style={{ margin: '0 0 8px' }}>Not found in ShiftReady ({none.length})</h3>
              <p className="note" style={{ marginTop: 0 }}>They’ll be in the sheet with the NI number left blank. If one of them is registered under a different name, pick them.</p>
              <div className="tablewrap"><table className="cards"><thead><tr><th>Name in timesheet</th><th>Site</th><th>Hours</th><th>Match</th></tr></thead><tbody>
                {none.map((r) => <tr key={r.key}>
                  <td><b>{r.fileName}</b></td>
                  <td data-l="Site">{r.site}</td>
                  <td data-l="Hours" className="mono">{hoursText(r)}</td>
                  <td data-l="Match">{r.suggestions.length ? picker(r, 'Leave NI blank') : <span className="pill warn">NI blank</span>}</td>
                </tr>)}
              </tbody></table></div>
            </div>
          )}

          <div>
            <h3 style={{ margin: '0 0 8px' }}>Matched ({matched.length})</h3>
            {!matched.length ? <p className="note">Nobody matched automatically.</p> : (
              <div className="tablewrap"><table className="cards"><thead><tr><th>Name in timesheet</th><th>In ShiftReady</th><th>Site</th><th>Hours</th><th></th></tr></thead><tbody>
                {matched.map((r) => <tr key={r.key}>
                  <td>{r.fileName}{r.timesheets > 1 && <div className="note">{r.timesheets} timesheets combined</div>}</td>
                  <td data-l="In ShiftReady"><b>{r.match!.name}</b></td>
                  <td data-l="Site">{r.site}</td>
                  <td data-l="Hours" className="mono">{hoursText(r)}</td>
                  <td>{r.match!.hasNi ? <span className="pill ok">NI on file</span> : <span className="pill warn">No NI on file</span>}</td>
                </tr>)}
              </tbody></table></div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
