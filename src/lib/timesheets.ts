import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { decrypt } from './crypto';

/**
 * Payroll: turn a client's weekly timesheet export (e.g. InPost) into our payroll layout,
 * with each worker's NI number pulled from ShiftReady.
 *
 * Input: one row per timesheet, with a "Worker" column, a "Location Name" column and pay lines
 * as column pairs "<line> Hours" / "<line> Pay Rate" (Standard Days, Standard Nights, Overtime...).
 * Output: one row per person. Their hours are added up per pay rate (so overtime at the same rate
 * and late timesheets merge in), giving up to three Hours / Pay Rate pairs, grouped by site.
 */

/** An error whose message is safe and useful to show the person. */
export class TimesheetError extends Error {}

export type PayLine = { hours: number; rate: number };
export type Person = {
  key: string;            // normalised name from the file; stable between "check" and "download"
  fileName: string;       // name as written in the timesheet file
  site: string;
  lines: PayLine[];       // hours per pay rate, lowest rate first
  timesheets: number;
};
export type Parsed = { client: string; weekEnding: string; people: Person[]; timesheets: number };

export type Suggestion = { id: string; name: string; hasNi: boolean };
export type MatchRow = {
  key: string;
  fileName: string;
  site: string;
  lines: PayLine[];
  timesheets: number;
  status: 'matched' | 'check' | 'none';
  match?: Suggestion;            // set when status is 'matched'
  suggestions: Suggestion[];     // possible matches when status is 'check' (or 'none' with near misses)
  reason?: string;
};
export type ConvertResult = { client: string; weekEnding: string; timesheets: number; rows: MatchRow[]; warnings: string[] };

// ---------- reading the file ----------

function text(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toLocaleDateString('en-GB', { timeZone: 'UTC' });
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return text(v.result as ExcelJS.CellValue);
    if ('text' in v) return String(v.text);
    return '';
  }
  return String(v);
}
function num(v: ExcelJS.CellValue): number {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && 'result' in v) return num(v.result as ExcelJS.CellValue);
  const n = parseFloat(text(v).replace(/[£,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
/**
 * Some client systems (InPost's export, for one) write valid .xlsx files that ExcelJS can't read:
 * a byte-order mark before the XML, namespace-prefixed tags (<x:sheet>) and absolute part paths.
 * Rewrite those parts into the everyday form Excel itself writes, then hand the file to ExcelJS.
 */
async function normalise(file: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(file);
  for (const name of Object.keys(zip.files)) {
    if (!/\.(xml|rels)$/i.test(name) || zip.files[name].dir) continue;
    let xml = (await zip.file(name)!.async('string')).replace(/^﻿/, '');
    const root = xml.match(/<([A-Za-z]\w*):\w+[\s>]/);
    // Drop the prefix if the root element uses one that is bound to the default SpreadsheetML/relationships namespace.
    if (root && new RegExp(`xmlns:${root[1]}="http://schemas\\.openxmlformats\\.org/`).test(xml)) {
      const p = root[1];
      xml = xml.replace(new RegExp(`<(/?)${p}:`, 'g'), '<$1').replace(new RegExp(`xmlns:${p}=`), 'xmlns=');
    }
    if (name.endsWith('.rels')) {
      const dir = name.replace(/_rels\/[^/]+$/, ''); // folder the rels file describes, e.g. "xl/"
      xml = xml.replace(/Target="\/([^"]+)"/g, (_, t: string) => `Target="${dir && t.startsWith(dir) ? t.slice(dir.length) : (dir ? '../'.repeat(dir.split('/').filter(Boolean).length) + t : t)}"`);
    }
    zip.file(name, xml);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const squash = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

export async function parseTimesheets(file: Buffer): Promise<Parsed> {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load((await normalise(file)) as unknown as ArrayBuffer); } catch { throw new TimesheetError('That doesn’t look like an Excel (.xlsx) file.'); }
  const ws = wb.worksheets.find((w) => w.rowCount > 0);
  if (!ws) throw new TimesheetError('The file is empty.');

  // Labels at the top, e.g. "Client:" | "InPost", "Week Ending:" | "27/09/2026".
  let client = '', weekEnding = '';
  // The header row is the first one with a "Worker" column.
  let headerRow = 0;
  const cols = new Map<string, number>();
  for (let r = 1; r <= Math.min(ws.rowCount, 40) && !headerRow; r++) {
    const row = ws.getRow(r);
    const label = squash(text(row.getCell(1).value));
    if (label.startsWith('client')) client = text(row.getCell(2).value).trim();
    if (label.startsWith('week ending')) weekEnding = text(row.getCell(2).value).trim();
    row.eachCell((c, n) => { if (squash(text(c.value)) === 'worker') headerRow = r; void n; });
    if (headerRow) row.eachCell((c, n) => { const h = squash(text(c.value)); if (h && !cols.has(h)) cols.set(h, n); });
  }
  if (!headerRow) throw new TimesheetError('Couldn’t find the “Worker” column. Is this the weekly timesheet export?');

  const workerCol = cols.get('worker')!;
  const siteCol = cols.get('location name') ?? cols.get('location') ?? cols.get('site');
  // Pay lines: every "<x> hours" column with a matching "<x> pay rate" column.
  const lineCols: { hours: number; rate: number }[] = [];
  for (const [h, n] of cols) {
    const m = h.match(/^(.+) hours$/);
    if (!m) continue;
    const rate = cols.get(`${m[1]} pay rate`);
    if (rate) lineCols.push({ hours: n, rate });
  }
  if (!lineCols.length) throw new TimesheetError('Couldn’t find any pay lines (columns like “Standard Days Hours” and “Standard Days Pay Rate”).');

  const people = new Map<string, Person & { byRate: Map<number, number> }>();
  let timesheets = 0;
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const name = text(row.getCell(workerCol).value).replace(/\s+/g, ' ').trim();
    if (!name) continue;
    timesheets++;
    const key = squash(name);
    let p = people.get(key);
    if (!p) {
      p = { key, fileName: name, site: siteCol ? text(row.getCell(siteCol).value).trim() : '', lines: [], timesheets: 0, byRate: new Map() };
      people.set(key, p);
    }
    p.timesheets++;
    for (const lc of lineCols) {
      const hours = num(row.getCell(lc.hours).value);
      const rate = r2(num(row.getCell(lc.rate).value));
      if (!hours || !rate) continue;
      p.byRate.set(rate, (p.byRate.get(rate) ?? 0) + hours);
    }
  }
  const out: Person[] = [...people.values()].map(({ byRate, ...p }) => ({
    ...p,
    lines: [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([rate, hours]) => ({ rate, hours: r2(hours) })),
  }));
  return { client, weekEnding, people: out, timesheets };
}

// ---------- matching names to temps ----------

const tokens = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z\s'-]/g, ' ').split(/[\s'-]+/).filter((w) => w.length > 1);

function lev(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}
const near = (a: string, b: string) => a === b || lev(a, b) <= (Math.min(a.length, b.length) >= 6 ? 2 : 1);

type Temp = { id: string; first: string[]; last: string[]; name: string; hasNi: boolean };

/** exact: first and surname both appear (any order, extra middle names fine). close: same, allowing small spelling slips. */
function score(file: string[], t: Temp): 'exact' | 'close' | null {
  const has = (ws: string[], exact: boolean) => ws.some((w) => file.some((f) => (exact ? f === w : near(f, w))));
  if (has(t.first, true) && has(t.last, true)) return 'exact';
  if (has(t.first, false) && has(t.last, false)) return 'close';
  return null;
}

export async function loadTemps(db: SupabaseClient): Promise<Temp[]> {
  const temps: Temp[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('temps').select('id,first_name,last_name').range(from, from + 999);
    if (error) throw new TimesheetError('Couldn’t load temps.');
    for (const t of data ?? []) temps.push({ id: t.id, first: tokens(t.first_name), last: tokens(t.last_name), name: `${t.first_name} ${t.last_name}`.trim(), hasNi: false });
    if (!data || data.length < 1000) break;
  }
  const byId = new Map(temps.map((t) => [t.id, t]));
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('temp_profiles').select('temp_id').not('ni_enc', 'is', null).range(from, from + 999);
    if (error) throw new TimesheetError('Couldn’t load NI numbers.');
    for (const r of data ?? []) { const t = byId.get(r.temp_id); if (t) t.hasNi = true; }
    if (!data || data.length < 1000) break;
  }
  return temps;
}

export function matchPeople(parsed: Parsed, temps: Temp[]): ConvertResult {
  const warnings: string[] = [];
  const sug = (t: Temp): Suggestion => ({ id: t.id, name: t.name, hasNi: t.hasNi });
  const rows: MatchRow[] = parsed.people.map((p) => {
    const f = tokens(p.fileName);
    const exact = temps.filter((t) => score(f, t) === 'exact');
    const close = exact.length ? [] : temps.filter((t) => score(f, t) === 'close');
    const base = { key: p.key, fileName: p.fileName, site: p.site, lines: p.lines, timesheets: p.timesheets };
    if (p.lines.length > 3) warnings.push(`${p.fileName} has ${p.lines.length} different pay rates; only 3 fit the layout, so check their line.`);
    if (exact.length === 1) {
      const m = exact[0];
      return { ...base, status: 'matched', match: sug(m), suggestions: [], reason: m.hasNi ? undefined : 'No NI number in ShiftReady yet' };
    }
    if (exact.length > 1) return { ...base, status: 'check', suggestions: exact.slice(0, 8).map(sug), reason: `${exact.length} temps share this name. Pick the right one` };
    if (close.length) return { ...base, status: 'check', suggestions: close.slice(0, 8).map(sug), reason: 'Name spelt differently in ShiftReady. Check it’s the same person' };
    // Nothing on both names: offer anyone sharing the surname as a starting point.
    const sameSurname = temps.filter((t) => t.last.some((w) => f.includes(w))).slice(0, 8).map(sug);
    return { ...base, status: 'none', suggestions: sameSurname, reason: 'Not found in ShiftReady' };
  });
  return { client: parsed.client, weekEnding: parsed.weekEnding, timesheets: parsed.timesheets, rows, warnings };
}

// ---------- building the payroll file ----------

const tidy = (s: string) => (s === s.toUpperCase() || s === s.toLowerCase())
  ? s.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, a, b) => a + b.toUpperCase())
  : s;

/** choices: for rows that needed checking, the temp id picked, or 'none' to leave the NI number blank. */
export async function payrollWorkbook(db: SupabaseClient, res: ConvertResult, choices: Record<string, string>) {
  // Decide which temp each row is.
  const pick = new Map<string, string | null>();
  for (const r of res.rows) {
    const c = choices[r.key];
    if (c && c !== 'none') pick.set(r.key, c);
    else if (c === 'none') pick.set(r.key, null);
    else pick.set(r.key, r.status === 'matched' ? r.match!.id : null);
  }
  const ids = [...new Set([...pick.values()].filter(Boolean))] as string[];

  const info = new Map<string, { first: string; last: string; ni: string }>();
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200);
    const { data: temps } = await db.from('temps').select('id,first_name,last_name').in('id', part);
    const { data: profs } = await db.from('temp_profiles').select('temp_id,ni_enc').in('temp_id', part);
    const ni = new Map((profs ?? []).map((p) => [p.temp_id, decrypt<string>(p.ni_enc) ?? '']));
    for (const t of temps ?? []) info.set(t.id, { first: t.first_name.trim(), last: t.last_name.trim(), ni: (ni.get(t.id) ?? '').replace(/\s+/g, '').toUpperCase() });
  }

  const wb = new ExcelJS.Workbook();
  wb.calcProperties.fullCalcOnLoad = true;
  const ws = wb.addWorksheet('Sheet1');
  const widths: Record<string, number> = { A: 15.38, B: 20.25, C: 20, D: 18, E: 9, F: 9, G: 9, H: 9, I: 9, J: 9, K: 4, L: 12 };
  for (const [c, w] of Object.entries(widths)) ws.getColumn(c).width = w;
  const font = { name: 'Arial', size: 11 };
  const head = ws.getRow(2);
  [['A', 'N/S'], ['B', 'Candidate Name'], ['C', 'Surname'], ['D', 'National Insurance'], ['E', 'Hours'], ['F', 'Pay Rate'], ['L', 'Total Pay ']]
    .forEach(([c, v]) => { const cell = head.getCell(c); cell.value = v; cell.font = { ...font, bold: true }; });

  // Group by site in the order sites first appear; within a site, alphabetical by first name.
  const sites: string[] = [];
  for (const r of res.rows) if (!sites.includes(r.site)) sites.push(r.site);
  let row = 5;
  const used: { name: string; ni: boolean }[] = [];
  for (const [si, site] of sites.entries()) {
    if (si > 0) row++; // blank row between sites
    const people = res.rows.filter((r) => r.site === site).map((r) => {
      const id = pick.get(r.key);
      const t = id ? info.get(id) : undefined;
      const parts = r.fileName.split(' ');
      return { r, t, first: t?.first ?? tidy(parts[0] ?? ''), last: t?.last ?? tidy(parts.slice(1).join(' ')) };
    }).sort((a, b) => a.first.localeCompare(b.first) || a.last.localeCompare(b.last));
    for (const p of people) {
      const x = ws.getRow(row);
      x.getCell('B').value = p.first;
      x.getCell('C').value = p.last;
      x.getCell('D').value = p.t?.ni ?? '';
      ['E', 'G', 'I'].forEach((hc, i) => {
        const l = p.r.lines[i];
        if (!l) return;
        x.getCell(hc).value = l.hours;
        x.getCell(String.fromCharCode(hc.charCodeAt(0) + 1)).value = l.rate;
      });
      x.getCell('L').value = { formula: `SUM(E${row}*F${row})+(G${row}*H${row})+(I${row}*J${row})` };
      x.eachCell({ includeEmpty: true }, (c) => { c.font = font; });
      ['F', 'H', 'J', 'L'].forEach((c) => { x.getCell(c).numFmt = '0.00'; });
      used.push({ name: `${p.first} ${p.last}`, ni: !!p.t?.ni });
      row++;
    }
  }
  const last = row - 1;
  const tot = row + 2;
  ws.getCell(`L${tot}`).value = { formula: `SUM(L5:L${last})` };
  ws.getCell(`L${tot + 1}`).value = { formula: `SUM(L${tot}*0.2)` };
  ws.getCell(`L${tot + 2}`).value = { formula: `SUM(L${tot}:L${tot + 1})` };
  for (let i = 0; i < 3; i++) { const c = ws.getCell(`L${tot + i}`); c.font = font; c.numFmt = '0.00'; }

  return { file: Buffer.from(await wb.xlsx.writeBuffer()), used };
}
