import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import ExcelJS from 'exceljs';
import { decrypt } from './crypto';
import { displayMobile } from './phone';

/** Payroll: someone pastes a list of names with NI numbers; we find those temps and build an Excel of their details. */

const NI_RE = /\b([A-Z]{2})\s?(\d{2})\s?(\d{2})\s?(\d{2})\s?([A-D])\b/i;
const words = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z\s'-]/g, ' ').split(/[\s'-]+/).filter((w) => w.length > 1);

export type StarterResult = {
  matched: { id: string; name: string; line: string; noBank: boolean }[];
  problems: { line: string; reason: string }[];
};

/** Does the pasted name fit the registered one? Surname must appear, plus the first name or its initial. */
function nameFits(pasted: string, first: string, last: string) {
  const p = new Set(words(pasted));
  const initials = pasted.toLowerCase().split(/[^a-z]+/).filter((x) => x.length === 1 || (x.length === 2 && !p.has(x)));
  const lastOk = words(last).some((w) => p.has(w));
  const f = words(first);
  const firstOk = f.some((w) => p.has(w)) || f.some((w) => initials.some((x) => x[0] === w[0]));
  return lastOk && firstOk;
}

export async function matchStarters(db: SupabaseClient, text: string): Promise<StarterResult> {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 500);
  const out: StarterResult = { matched: [], problems: [] };
  if (!lines.length) return out;

  // NI numbers are encrypted, so read them all once and index them.
  const byNi = new Map<string, string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('temp_profiles').select('temp_id,ni_enc').not('ni_enc', 'is', null).range(from, from + 999);
    if (error) throw new Error('Couldn’t load NI numbers.');
    for (const r of data ?? []) {
      try { const ni = decrypt<string>(r.ni_enc); if (ni) byNi.set(ni.replace(/\s+/g, '').toUpperCase(), r.temp_id); } catch { /* skip unreadable row */ }
    }
    if (!data || data.length < 1000) break;
  }

  const wanted: { line: string; name: string; id: string }[] = [];
  for (const line of lines) {
    const m = line.match(NI_RE);
    if (!m) {
      if (/name|insurance|\bni\b/i.test(line) && !/\d/.test(line)) continue; // a header row
      out.problems.push({ line, reason: 'No NI number on this line' });
      continue;
    }
    const ni = m.slice(1).join('').toUpperCase();
    const name = line.replace(m[0], ' ').replace(/[\t,;|]+/g, ' ').replace(/\s+/g, ' ').trim();
    const id = byNi.get(ni);
    if (!id) { out.problems.push({ line, reason: 'NI number not found in ShiftReady' }); continue; }
    if (!words(name).length) { out.problems.push({ line, reason: 'Add their name next to the NI number' }); continue; }
    wanted.push({ line, name, id });
  }

  const ids = [...new Set(wanted.map((w) => w.id))];
  const temps = new Map<string, { first_name: string; last_name: string; registered_at: string | null; bank_on_file: boolean }>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from('temps').select('id,first_name,last_name,registered_at,bank_on_file').in('id', ids.slice(i, i + 200));
    for (const t of data ?? []) temps.set(t.id, t);
  }
  const seen = new Set<string>();
  for (const w of wanted) {
    const t = temps.get(w.id);
    if (!t) { out.problems.push({ line: w.line, reason: 'NI number not found in ShiftReady' }); continue; }
    const full = `${t.first_name} ${t.last_name}`;
    if (!nameFits(w.name, t.first_name, t.last_name)) { out.problems.push({ line: w.line, reason: `That NI number belongs to ${full}. Check the name or NI number` }); continue; }
    if (!t.registered_at) { out.problems.push({ line: w.line, reason: `${full} hasn’t finished registering` }); continue; }
    if (seen.has(w.id)) continue;
    seen.add(w.id);
    out.matched.push({ id: w.id, name: full, line: w.line, noBank: !t.bank_on_file });
  }
  return out;
}

export async function startersWorkbook(db: SupabaseClient, ids: string[]): Promise<Buffer> {
  const { data: temps } = await db.from('temps').select('id,first_name,last_name,mobile,postcode').in('id', ids);
  const { data: profs } = await db.from('temp_profiles').select('temp_id,dob,email,address1,address2,town,ni_enc,bank_enc').in('temp_id', ids);
  const prof = new Map((profs ?? []).map((p) => [p.temp_id, p]));
  const order = new Map(ids.map((id, i) => [id, i]));

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('New starters');
  ws.columns = [
    { header: 'Full name', key: 'name', width: 26 },
    { header: 'Address line 1', key: 'a1', width: 30 },
    { header: 'Address line 2', key: 'a2', width: 22 },
    { header: 'Town', key: 'town', width: 18 },
    { header: 'Postcode', key: 'pc', width: 11 },
    { header: 'Phone number', key: 'phone', width: 15 },
    { header: 'Email address', key: 'email', width: 30 },
    { header: 'Date of birth', key: 'dob', width: 13 },
    { header: 'NI number', key: 'ni', width: 13 },
    { header: 'Bank account name', key: 'bname', width: 26 },
    { header: 'Account number', key: 'acc', width: 15 },
    { header: 'Sort code', key: 'sort', width: 11 },
  ];
  ws.columns.forEach((c) => { c.numFmt = '@'; }); // text, so leading zeros in account numbers and phones stay
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  for (const t of [...(temps ?? [])].sort((a, b) => order.get(a.id)! - order.get(b.id)!)) {
    const p = prof.get(t.id);
    const ni = decrypt<string>(p?.ni_enc);
    const bank = decrypt<{ name: string; sortCode: string; account: string }>(p?.bank_enc);
    ws.addRow({
      name: `${t.first_name} ${t.last_name}`,
      a1: p?.address1 ?? '', a2: p?.address2 ?? '', town: p?.town ?? '', pc: t.postcode ?? '',
      phone: displayMobile(t.mobile).replace(/\s/g, ''),
      email: p?.email ?? '',
      dob: p?.dob ? new Date(p.dob + 'T12:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC' }) : '',
      ni: ni ?? '',
      bname: bank?.name ?? 'NOT GIVEN YET',
      acc: bank?.account ?? '',
      sort: bank ? bank.sortCode.replace(/(\d{2})(\d{2})(\d{2})/, '$1-$2-$3') : '',
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
