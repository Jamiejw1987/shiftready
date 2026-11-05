'use client';
import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { displayMobile } from '@/lib/phone';
import { revealBank, type BankDetails } from './actions';
import { sendBankLink } from '../temps/[id]/actions';

export type BankRow = { id: string; first: string; last: string; mobile: string; status: string; onFile: boolean; last4: string | null; addedAt: string | null };

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' }) : '');
const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function BankClient({ rows }: { rows: BankRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState('');
  const [view, setView] = useState<'on' | 'missing'>('on');
  const [shown, setShown] = useState<Record<string, BankDetails>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState('');

  const onFile = rows.filter((r) => r.onFile);
  const missing = rows.filter((r) => !r.onFile);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/\s+/g, ' ');
    const digits = s.replace(/\D/g, '');
    return (view === 'on' ? onFile : missing).filter((r) =>
      !s || `${r.first} ${r.last}`.toLowerCase().includes(s) || (digits.length >= 3 && (r.mobile.includes(digits.replace(/^0/, '')) || (r.last4 ?? '').includes(digits))));
  }, [q, view, onFile, missing]);

  function show(ids: string[]) {
    setMsg(null);
    start(async () => {
      const r = await revealBank(ids, 'view');
      if (!r.ok) return setMsg({ ok: false, text: r.error! });
      setShown((s) => ({ ...s, ...r.details }));
    });
  }

  function download() {
    setMsg(null);
    const ids = list.filter((r) => r.onFile).map((r) => r.id);
    start(async () => {
      const r = await revealBank(ids, 'download');
      if (!r.ok) return setMsg({ ok: false, text: r.error! });
      const lines = [['First name', 'Surname', 'Mobile', 'Name on account', 'Sort code', 'Account number'].join(',')];
      for (const row of list) {
        const d = r.details![row.id];
        if (d) lines.push([row.first, row.last, displayMobile(row.mobile), d.name, d.sortCode, d.account].map(csvCell).join(','));
      }
      const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url; a.download = `bank-details-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setMsg({ ok: true, text: `Downloaded ${lines.length - 1} temps. Keep the file safe and delete it once payroll is done.` });
    });
  }

  function request(id: string) {
    setMsg(null);
    start(async () => {
      const r = await sendBankLink(id);
      setMsg({ ok: r.ok, text: r.ok ? r.message! : r.error! });
      if (r.ok) router.refresh();
    });
  }

  async function copy(key: string, text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(''), 1500); } catch { /* clipboard blocked */ }
  }

  const anyHidden = list.some((r) => r.onFile && !shown[r.id]);

  return (
    <section className="panel">
      <h1>Bank details</h1>
      <p className="lede">Admins only. Details stay hidden until you press Show, and every view or download is recorded in the audit trail on the Team page.</p>

      <div className="btnrow" style={{ marginBottom: 12 }}>
        <button type="button" className={`chip${view === 'on' ? ' on' : ''}`} onClick={() => setView('on')}>On file ({onFile.length})</button>
        <button type="button" className={`chip${view === 'missing' ? ' on' : ''}`} onClick={() => setView('missing')}>Missing ({missing.length})</button>
      </div>

      <div className="bank-tools">
        <label className="f" style={{ flex: 1, minWidth: 0 }}><span className="l">Search</span>
          <input type="search" placeholder="Name, mobile or last 4 digits" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" /></label>
        {view === 'on' && (
          <div className="btnrow">
            {anyHidden
              ? <button className="btn ghost" disabled={pending || !list.length} onClick={() => show(list.filter((r) => !shown[r.id]).map((r) => r.id))}>Show all {list.length}</button>
              : <button className="btn ghost" disabled={!list.length} onClick={() => setShown({})}>Hide all</button>}
            <button className="btn blue" disabled={pending || !list.length} onClick={download}>{pending ? 'Working…' : 'Download CSV'}</button>
          </div>
        )}
      </div>

      {msg && <p className={msg.ok ? 'okmsg' : 'err'} style={{ margin: '10px 0' }}>{msg.text}</p>}

      {!list.length ? (
        <p className="note" style={{ marginTop: 14 }}>{q ? 'Nobody matches that search.' : view === 'on' ? 'No bank details on file yet.' : 'Everyone registered has added bank details.'}</p>
      ) : (
        <div className="members" style={{ marginTop: 14 }}>
          {list.map((r) => {
            const d = shown[r.id];
            return (
              <article key={r.id} className="bank-row">
                <div className="member-name">
                  <Link href={`/temps/${r.id}`}><b>{r.first} {r.last}</b></Link>
                  <div className="note">{displayMobile(r.mobile)}{r.status === 'hold' ? ' · on hold' : ''}</div>
                </div>
                {r.onFile ? (
                  d ? (
                    <dl className="bank-details">
                      <div><dt>Name on account</dt><dd>{d.name}</dd></div>
                      <div><dt>Sort code</dt><dd><button className="copy" onClick={() => copy(`${r.id}s`, d.sortCode.replace(/-/g, ''))}>{d.sortCode}{copied === `${r.id}s` ? ' ✓' : ''}</button></dd></div>
                      <div><dt>Account</dt><dd><button className="copy" onClick={() => copy(`${r.id}a`, d.account)}>{d.account}{copied === `${r.id}a` ? ' ✓' : ''}</button></dd></div>
                    </dl>
                  ) : (
                    <div className="bank-hidden"><span className="mono">•••• {r.last4}</span><span className="note"> · added {day(r.addedAt)}</span></div>
                  )
                ) : (
                  <div className="bank-hidden"><span className="pill warn">No bank details</span></div>
                )}
                <div className="btnrow bank-act">
                  {r.onFile
                    ? (d ? <button className="btn ghost small" onClick={() => setShown(({ [r.id]: _, ...rest }) => rest)}>Hide</button>
                         : <button className="btn ghost small" disabled={pending} onClick={() => show([r.id])}>Show</button>)
                    : <button className="btn ghost small" disabled={pending} onClick={() => request(r.id)}>Text bank details link</button>}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {view === 'on' && <p className="note" style={{ marginTop: 12 }}>Tap a sort code or account number to copy it. To change someone’s details, open their record and use Clear bank details, then text them the link.</p>}
    </section>
  );
}
