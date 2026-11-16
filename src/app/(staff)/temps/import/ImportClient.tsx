'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { displayMobile } from '@/lib/phone';
import { parseCSV } from '../csv';
import { FIELDS, guessMapping, readRow, type Mapping, type ImportField, type Checked, type ImportRecord } from '@/lib/importParse';
import { importBatch, type ImportOptions } from './actions';

const BATCH = 200;
type Client = { id: string; name: string };
type Totals = { added: number; updated: number; assigned: number; skipped: { row: number; reason: string }[]; clientsCreated: string[] };

export function ImportClient({ clients, existingMobiles, encryption }: { clients: Client[]; existingMobiles: string[]; encryption: boolean }) {
  const router = useRouter();
  const known = useMemo(() => new Set(existingMobiles), [existingMobiles]);
  const [file, setFile] = useState<{ name: string; head: string[]; body: string[][] } | null>(null);
  const [map, setMap] = useState<Mapping>({});
  const [err, setErr] = useState('');
  const [over, setOver] = useState(false);
  const [source, setSource] = useState('KISREC');
  const [ongoingMode, setOngoingMode] = useState<'none' | 'one' | 'column'>('none');
  const [clientId, setClientId] = useState('');
  const [createClients, setCreateClients] = useState(true);
  const [dupes, setDupes] = useState<'skip' | 'fill'>('fill');
  const [view, setView] = useState<'all' | 'problems' | 'warnings' | 'here'>('all');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState<Totals | null>(null);

  function load(f: File) {
    setErr(''); setDone(null);
    if (!/\.csv$/i.test(f.name) && f.type !== 'text/csv') return setErr('Save the export as a CSV file (in Excel: File > Save As > CSV) and upload that.');
    const r = new FileReader();
    r.onload = () => {
      const rows = parseCSV(String(r.result));
      if (rows.length < 2) return setErr('That file looks empty.');
      const head = rows[0].map((h) => h.replace(/^﻿/, '').trim());
      setFile({ name: f.name, head, body: rows.slice(1) });
      const m = guessMapping(head);
      setMap(m);
      if (m.client != null) setOngoingMode('column');
    };
    r.readAsText(f);
  }

  const checked: Checked[] = useMemo(() => {
    if (!file) return [];
    const seen = new Set<string>();
    return file.body.map((r, i) => {
      const c = readRow(r, map, i + 2);
      if (c.e164) { if (seen.has(c.e164)) c.problems.push('Same mobile as an earlier row'); seen.add(c.e164); }
      return c;
    });
  }, [file, map]);
  const nameMapped = map.first != null || map.full != null;
  const ready = checked.filter((c) => !c.problems.length);
  const here = ready.filter((c) => c.e164 && known.has(c.e164));
  const fresh = ready.length - here.length;
  const withWarn = ready.filter((c) => c.warnings.length);
  const clientNames = useMemo(() => [...new Set(checked.map((c) => c.client).filter(Boolean))], [checked]);
  const lower = new Set(clients.map((c) => c.name.trim().toLowerCase()));
  const unknownClients = clientNames.filter((n) => !lower.has(n.trim().toLowerCase()));
  const willAssign = ongoingMode === 'one' ? (clientId ? ready.length : 0)
    : ongoingMode === 'column' ? ready.filter((c) => c.client && (createClients || lower.has(c.client.trim().toLowerCase()))).length : 0;
  const counts = { ni: ready.filter((c) => c.ni).length, bank: ready.filter((c) => c.account).length, addr: ready.filter((c) => c.address1 || c.postcode).length, rtw: ready.filter((c) => c.rtwRoute).length };
  const shown = checked.filter((c) => view === 'all' ? true : view === 'problems' ? c.problems.length : view === 'warnings' ? !c.problems.length && c.warnings.length : !c.problems.length && c.e164 && known.has(c.e164));

  async function run() {
    if (!ready.length) return;
    const opts: ImportOptions = { source, dupes, clientId: ongoingMode === 'one' ? clientId || null : null, useClientColumn: ongoingMode === 'column', createClients };
    if (ongoingMode === 'one' && !clientId) return setErr('Choose the client, or pick “Don’t mark as ongoing”.');
    setBusy(true); setErr(''); setProgress(0);
    const totals: Totals = { added: 0, updated: 0, assigned: 0, skipped: checked.filter((c) => c.problems.length).map((c) => ({ row: c.row, reason: c.problems.join('; ') })), clientsCreated: [] };
    const records: ImportRecord[] = ready.map(({ problems: _p, warnings: _w, e164: _e, ...rec }) => rec); // eslint-disable-line @typescript-eslint/no-unused-vars
    for (let i = 0; i < records.length; i += BATCH) {
      let r;
      try { r = await importBatch(records.slice(i, i + BATCH), opts); }
      catch { r = { ok: false, error: 'Lost connection part-way through.', added: 0, updated: 0, assigned: 0, skipped: [], clientsCreated: [] }; }
      totals.added += r.added; totals.updated += r.updated; totals.assigned += r.assigned;
      totals.skipped.push(...r.skipped); totals.clientsCreated.push(...r.clientsCreated);
      if (!r.ok) {
        setErr(`${r.error} Stopped after ${i + r.added} rows. Fix this and upload the same file again with “Fill in blanks”: anyone already imported is matched, not doubled up.`);
        break;
      }
      setProgress(Math.min(records.length, i + BATCH) / records.length);
    }
    setDone(totals); setBusy(false); setFile(null);
    router.refresh();
  }

  function skippedCsv(t: Totals) {
    const lines = ['Row,Reason', ...t.skipped.sort((a, b) => a.row - b.row).map((s) => `${s.row},"${s.reason.replace(/"/g, '""')}"`)];
    const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'import-skipped-rows.csv'; a.click(); URL.revokeObjectURL(url);
  }

  const groups = [...new Set(FIELDS.map((f) => f.group))];
  const sample = (k: ImportField) => (file && map[k] != null ? file.body.find((r) => (r[map[k]!] ?? '').trim())?.[map[k]!] ?? '' : '');
  const secret = (k: ImportField) => ['ni', 'sortCode', 'account', 'shareCode'].includes(k);

  return (
    <>
      {done && (
        <section className="panel">
          <h2>Import finished</h2>
          <div className="summary">
            <span className="pill ok">{done.added} added</span>
            {done.updated > 0 && <span className="pill blue">{done.updated} already here, blanks filled in</span>}
            {done.assigned > 0 && <span className="pill blue">{done.assigned} marked ongoing at a client</span>}
            {done.skipped.length > 0 && <span className="pill bad">{done.skipped.length} skipped</span>}
          </div>
          <p className="note">Nothing was sent to anyone. Everyone imported shows <b>Messages off</b> on the Temps list.{done.clientsCreated.length ? ` New clients added: ${done.clientsCreated.join(', ')}.` : ''}</p>
          {done.skipped.length > 0 && <button className="btn ghost small" onClick={() => skippedCsv(done)}>Download list of skipped rows</button>}
          <p className="note" style={{ marginBottom: 0 }}>Delete the CSV from your computer now it’s in ShiftReady: it holds NI numbers and bank details.</p>
        </section>
      )}

      <section className="panel">
        <h2>1. Upload the CSV</h2>
        <div className={over ? 'drop over' : 'drop'}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) load(f); }}>
          <div className="btnrow">
            <label className="btn ghost" htmlFor="impFile">Choose CSV file</label>
            <input id="impFile" type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) load(f); e.target.value = ''; }} />
          </div>
          <span className="note">{file ? `${file.name}: ${file.body.length} rows` : 'Or drag the file onto this box. The file is read here and isn’t stored.'}</span>
        </div>
        {err && <p className="err" style={{ marginTop: 10 }}>{err}</p>}
      </section>

      {file && (
        <>
          <section className="panel">
            <h2>2. Match the columns</h2>
            <p className="lede">We’ve matched what we could from the headings. Check them and fix any that are wrong. Only name and mobile are required.</p>
            {groups.map((g) => (
              <div key={g} style={{ marginBottom: 12 }}>
                <h3 style={{ margin: '6px 0' }}>{g}</h3>
                <div className="form">
                  {FIELDS.filter((f) => f.group === g).map((f) => (
                    <div className="f w2" key={f.key}>
                      <label className="l" htmlFor={`m-${f.key}`}>{f.label}</label>
                      <select id={`m-${f.key}`} value={map[f.key] ?? ''} onChange={(e) => setMap({ ...map, [f.key]: e.target.value === '' ? undefined : +e.target.value })}>
                        <option value="">Not in file</option>
                        {file.head.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                      </select>
                      {map[f.key] != null && <span className="note">e.g. {secret(f.key) ? '••••' + String(sample(f.key)).slice(-2) : String(sample(f.key)).slice(0, 40) || '(blank)'}</span>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {!nameMapped && <p className="err">Choose the column for first name (or full name).</p>}
            {map.mobile == null && <p className="err">Choose the mobile column. ShiftReady needs a UK mobile for each worker.</p>}
            {!encryption && (map.ni != null || map.account != null) && <p className="alert">NI and bank columns will be ignored: the encryption key isn’t set.</p>}
          </section>

          <section className="panel">
            <h2>3. Options</h2>
            <div className="form">
              <div className="f w2"><label className="l" htmlFor="impSrc">Where they’re from</label>
                <input id="impSrc" type="text" value={source} onChange={(e) => setSource(e.target.value)} /><span className="note">Shown on each record, e.g. “Imported from KISREC”.</span></div>
              <div className="f w2"><span className="l">If they’re already on ShiftReady</span>
                <div className="chips">
                  <label className="chip"><input type="radio" checked={dupes === 'fill'} onChange={() => setDupes('fill')} /> Fill in blanks</label>
                  <label className="chip"><input type="radio" checked={dupes === 'skip'} onChange={() => setDupes('skip')} /> Leave them alone</label>
                </div>
                <span className="note">Matched by mobile, then NI number, then old-system ID. Nothing they already have is overwritten.</span></div>
            </div>
            <div className="f" style={{ marginTop: 12 }}><span className="l">Ongoing at a client</span>
              <div className="chips">
                <label className="chip"><input type="radio" checked={ongoingMode === 'none'} onChange={() => setOngoingMode('none')} /> Don’t mark as ongoing</label>
                <label className="chip"><input type="radio" checked={ongoingMode === 'one'} onChange={() => setOngoingMode('one')} /> Everyone in this file works at one client</label>
                <label className="chip"><input type="radio" checked={ongoingMode === 'column'} disabled={map.client == null} onChange={() => setOngoingMode('column')} /> Use the client column{map.client == null ? ' (none matched)' : ''}</label>
              </div>
            </div>
            {ongoingMode === 'one' && (
              <div className="f" style={{ maxWidth: 360, marginTop: 8 }}><label className="l" htmlFor="impClient">Client</label>
                <select id="impClient" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                  <option value="">Choose a client</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                {!clients.length && <span className="note">No clients yet. Add one on the Clients page first, or use the client column.</span>}</div>
            )}
            {ongoingMode === 'column' && (
              <div style={{ marginTop: 8 }}>
                <p className="note" style={{ margin: 0 }}>{clientNames.length} client name{clientNames.length === 1 ? '' : 's'} in the file{unknownClients.length ? `, ${unknownClients.length} not on ShiftReady yet: ${unknownClients.slice(0, 8).join(', ')}${unknownClients.length > 8 ? '…' : ''}` : ', all already on ShiftReady'}. Rows with a blank client aren’t marked as ongoing.</p>
                {unknownClients.length > 0 && <label className="chip" style={{ marginTop: 6 }}><input type="checkbox" checked={createClients} onChange={(e) => setCreateClients(e.target.checked)} /> Add those {unknownClients.length} as new clients</label>}
              </div>
            )}
          </section>

          <section className="panel">
            <h2>4. Check and import</h2>
            <div className="summary">
              <span className="pill mute">{checked.length} rows</span>
              <span className="pill ok">{fresh} new</span>
              {here.length > 0 && <span className="pill blue">{here.length} already on ShiftReady</span>}
              {checked.length - ready.length > 0 && <span className="pill bad">{checked.length - ready.length} will be skipped</span>}
              {withWarn.length > 0 && <span className="pill warn">{withWarn.length} with a detail left off</span>}
            </div>
            <p className="note">Of the {ready.length} going in: {counts.addr} with an address, {counts.ni} with NI, {counts.bank} with bank details, {counts.rtw} with right to work, {willAssign} marked ongoing at a client.</p>
            <div className="chips" style={{ margin: '8px 0' }}>
              {([['all', 'All'], ['problems', 'Skipped'], ['warnings', 'Detail left off'], ['here', 'Already here']] as const).map(([k, l]) =>
                <button key={k} type="button" className={`chip${view === k ? ' on' : ''}`} onClick={() => setView(k)}>{l}</button>)}
            </div>
            <div className="tablewrap"><table className="cards">
              <thead><tr><th>Row</th><th>Worker</th><th>Mobile</th><th>Postcode</th><th>Client</th><th>Check</th></tr></thead>
              <tbody>
                {shown.slice(0, 100).map((c) => (
                  <tr key={c.row} className={c.problems.length ? 'bad' : ''}>
                    <td className="num" data-l="Row">{c.row}</td>
                    <td><b>{c.first} {c.last !== '-' ? c.last : ''}</b>{c.ref && <div className="note">Ref {c.ref}</div>}</td>
                    <td className="num" data-l="Mobile">{c.e164 ? displayMobile(c.e164) : c.mobile || '-'}</td>
                    <td className="mono" data-l="Postcode">{c.postcode || '-'}</td>
                    <td data-l="Client">{ongoingMode === 'one' ? clients.find((x) => x.id === clientId)?.name ?? '-' : ongoingMode === 'column' ? c.client || '-' : '-'}</td>
                    <td>{c.problems.length ? <span className="err">{c.problems.join('; ')}</span>
                      : <>{c.e164 && known.has(c.e164) ? <span className="pill blue">{dupes === 'fill' ? 'Here: fill blanks' : 'Here: leave'}</span> : <span className="pill ok">New</span>}
                        {c.warnings.length > 0 && <div className="note">{c.warnings.join('; ')}</div>}</>}</td>
                  </tr>
                ))}
                {!shown.length && <tr><td colSpan={6} className="note">Nothing here.</td></tr>}
              </tbody>
            </table></div>
            {shown.length > 100 && <p className="note">Showing the first 100 of {shown.length}.</p>}
            {busy && <div style={{ marginTop: 12 }}><div style={{ height: 8, background: 'var(--line, #ddd)', borderRadius: 4 }}><div style={{ height: 8, width: `${Math.round(progress * 100)}%`, background: 'var(--blue, #1d4ed8)', borderRadius: 4, transition: 'width .3s' }} /></div><p className="note">Importing… {Math.round(progress * 100)}%. Keep this page open.</p></div>}
            <div className="bar">
              <span className="note"><b>No texts, WhatsApps or emails will be sent.</b> Everyone imported has messages off.</span>
              <div className="btnrow">
                <button className="btn ghost" disabled={busy} onClick={() => setFile(null)}>Cancel</button>
                <button className="btn blue" disabled={busy || !ready.length || !nameMapped || map.mobile == null || (ongoingMode === 'one' && !clientId)} onClick={run}>
                  {busy ? 'Importing…' : `Import ${ready.length} worker${ready.length === 1 ? '' : 's'}`}</button>
              </div>
            </div>
          </section>
        </>
      )}
    </>
  );
}
