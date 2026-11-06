'use client';
import { useState, useTransition } from 'react';
import { checkStarters, downloadStarters } from './actions';
import type { StarterResult } from '@/lib/starters';

export function PayrollClient() {
  const [text, setText] = useState('');
  const [checked, setChecked] = useState('');
  const [res, setRes] = useState<StarterResult | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  function check() {
    setMsg(null);
    start(async () => {
      const r = await checkStarters(text);
      if (!r.ok) { setRes(null); return setMsg({ ok: false, text: r.error! }); }
      setRes(r.result!); setChecked(text);
    });
  }

  function download() {
    setMsg(null);
    start(async () => {
      const r = await downloadStarters(checked);
      if (!r.ok) return setMsg({ ok: false, text: r.error! });
      const bytes = Uint8Array.from(atob(r.file!), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a');
      a.href = url; a.download = `payroll-new-starters-${new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' })}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setMsg({ ok: true, text: `Downloaded details for ${r.count} ${r.count === 1 ? 'person' : 'people'}. Keep the file safe and delete it once payroll is done.` });
    });
  }

  const stale = res && text !== checked;
  return (
    <section className="panel">
      <h2>New starters for payroll</h2>
      <p className="note" style={{ marginTop: 0 }}>Paste a list of names with their NI numbers, one person per line (straight from Excel or an email is fine). We match each person by NI number and check the name, then you can download an Excel with their name, address, phone, email, date of birth, NI number and bank details.</p>
      <textarea rows={10} style={{ width: '100%', fontFamily: 'var(--f-mono)' }} placeholder={'John Smith  AB 12 34 56 C\nSarah Jones, CD123456A'} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="btnrow" style={{ marginTop: 12 }}>
        <button className="btn blue" disabled={pending || !text.trim()} onClick={check}>{pending && !res ? 'Checking…' : 'Check list'}</button>
        {res && res.matched.length > 0 && !stale && <button className="btn" disabled={pending} onClick={download}>{pending ? 'Working…' : `Download Excel (${res.matched.length})`}</button>}
        {stale && <span className="note">The list has changed. Check it again before downloading.</span>}
      </div>
      {msg && <p className={msg.ok ? 'ok' : 'err'}>{msg.text}</p>}

      {res && (
        <div style={{ marginTop: 18, display: 'grid', gap: 18 }}>
          {res.problems.length > 0 && (
            <div>
              <h3 style={{ margin: '0 0 8px' }}>Not included ({res.problems.length})</h3>
              <div className="tablewrap"><table className="cards"><thead><tr><th>Line</th><th>Why</th></tr></thead><tbody>
                {res.problems.map((p, i) => <tr key={i}><td className="mono">{p.line}</td><td data-l="Why"><span className="pill bad">Check</span> {p.reason}</td></tr>)}
              </tbody></table></div>
            </div>
          )}
          <div>
            <h3 style={{ margin: '0 0 8px' }}>Matched ({res.matched.length})</h3>
            {!res.matched.length ? <p className="note">Nobody matched yet.</p> : (
              <div className="tablewrap"><table className="cards"><thead><tr><th>Name in ShiftReady</th><th>You pasted</th><th></th></tr></thead><tbody>
                {res.matched.map((m) => <tr key={m.id}><td><b>{m.name}</b></td><td className="mono" data-l="You pasted">{m.line}</td>
                  <td>{m.noBank ? <span className="pill warn">No bank details yet</span> : <span className="pill ok">Ready</span>}</td></tr>)}
              </tbody></table></div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
