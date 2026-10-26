/** CSV parsing for KISREC exports (runs in the browser so we can preview before saving). */

export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

const ALIAS: Record<string, string[]> = {
  first: ['first name', 'firstname', 'forename', 'first'],
  last: ['surname', 'last name', 'lastname', 'last'],
  full: ['name', 'full name', 'candidate name', 'candidate'],
  mob: ['mobile', 'mobile number', 'mobile phone', 'phone', 'telephone', 'tel', 'mobile no'],
  pc: ['postcode', 'post code', 'postal code'],
  types: ['job types', 'job type', 'skills', 'roles', 'categories', 'cleared for'],
};

export function normaliseType(s: string): string | null {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  if (/flt|forklift|counterbalance/.test(t)) return 'FLT counterbalance';
  if (/warehouse|picker|packer|operative/.test(t)) return 'Warehouse';
  if (/production|line|factory/.test(t)) return 'Production';
  if (/clean/.test(t)) return 'Cleaning';
  return null;
}

export type MappedRow = { first: string; last: string; mobile: string; postcode: string; types: string[]; rawTypes: string };

export function mapRows(rows: string[][]): { error?: string; rows?: MappedRow[] } {
  if (rows.length < 2) return { error: 'That file looks empty.' };
  const head = rows[0].map((h) => h.trim().toLowerCase().replace(/^﻿/, ''));
  const idx: Record<string, number> = {};
  for (const k in ALIAS) idx[k] = head.findIndex((h) => ALIAS[k].includes(h));
  if (((idx.first < 0 || idx.last < 0) && idx.full < 0) || idx.mob < 0 || idx.pc < 0)
    return { error: 'Couldn’t find the columns. The CSV needs headers for first name and surname (or name), mobile and postcode. Job types is optional.' };
  return {
    rows: rows.slice(1).map((r) => {
      const g = (k: string) => (idx[k] >= 0 ? (r[idx[k]] || '').trim() : '');
      let first = g('first'), last = g('last');
      if (!first && g('full')) { const p = g('full').split(/\s+/); first = p.shift() || ''; last = p.join(' '); }
      const rawTypes = g('types');
      const types = [...new Set(rawTypes.split(/[;|/,]/).map(normaliseType).filter(Boolean) as string[])];
      return { first, last, mobile: g('mob'), postcode: g('pc'), types: types.length ? types : ['Warehouse'], rawTypes };
    }),
  };
}
