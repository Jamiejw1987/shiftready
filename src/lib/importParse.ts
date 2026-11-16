/**
 * Reading worker exports from other temp systems (KISREC and the like) for the silent import.
 * Pure functions: used in the browser for the preview and on the server when saving.
 */
import { toE164 } from './phone';

export type ImportField =
  | 'first' | 'last' | 'full' | 'mobile' | 'email' | 'dob' | 'address1' | 'address2' | 'town' | 'postcode' | 'nationality'
  | 'ni' | 'bankName' | 'sortCode' | 'account' | 'rtwType' | 'shareCode' | 'rtwChecked' | 'rtwExpires'
  | 'jobTypes' | 'client' | 'site' | 'startDate' | 'jobTitle' | 'ref';

export const FIELDS: { key: ImportField; label: string; group: string; aliases: string[] }[] = [
  { key: 'first', label: 'First name', group: 'Name', aliases: ['first name', 'firstname', 'forename', 'forenames', 'first', 'given name'] },
  { key: 'last', label: 'Surname', group: 'Name', aliases: ['surname', 'last name', 'lastname', 'last', 'family name'] },
  { key: 'full', label: 'Full name (if no separate columns)', group: 'Name', aliases: ['name', 'full name', 'candidate name', 'candidate', 'worker', 'worker name', 'employee name'] },
  { key: 'mobile', label: 'Mobile', group: 'Contact', aliases: ['mobile', 'mobile number', 'mobile phone', 'mobile no', 'mobile tel', 'phone', 'telephone', 'tel', 'phone number', 'contact number', 'mobile telephone'] },
  { key: 'email', label: 'Email', group: 'Contact', aliases: ['email', 'email address', 'e-mail', 'e-mail address'] },
  { key: 'dob', label: 'Date of birth', group: 'Personal', aliases: ['dob', 'date of birth', 'birth date', 'd.o.b', 'd.o.b.', 'birthdate'] },
  { key: 'nationality', label: 'Nationality', group: 'Personal', aliases: ['nationality'] },
  { key: 'address1', label: 'Address line 1', group: 'Address', aliases: ['address', 'address 1', 'address1', 'address line 1', 'street', 'house', 'address line1'] },
  { key: 'address2', label: 'Address line 2', group: 'Address', aliases: ['address 2', 'address2', 'address line 2', 'address line2', 'locality', 'district', 'area'] },
  { key: 'town', label: 'Town / city', group: 'Address', aliases: ['town', 'city', 'town/city', 'town / city', 'post town', 'address 3', 'address3', 'address line 3', 'county'] },
  { key: 'postcode', label: 'Postcode', group: 'Address', aliases: ['postcode', 'post code', 'postal code', 'zip'] },
  { key: 'ni', label: 'NI number', group: 'Payroll', aliases: ['ni', 'ni number', 'ni no', 'nino', 'national insurance', 'national insurance number', 'ni no.', 'n.i. number', 'nin'] },
  { key: 'bankName', label: 'Name on bank account', group: 'Payroll', aliases: ['account name', 'bank account name', 'name on account', 'account holder', 'account holder name'] },
  { key: 'sortCode', label: 'Sort code', group: 'Payroll', aliases: ['sort code', 'sortcode', 'bank sort code', 'sort'] },
  { key: 'account', label: 'Account number', group: 'Payroll', aliases: ['account number', 'account no', 'bank account number', 'account', 'acc no', 'account num', 'bank account'] },
  { key: 'rtwType', label: 'Right to work type', group: 'Right to work', aliases: ['rtw', 'rtw type', 'right to work', 'right to work type', 'rtw document', 'rtw route', 'id type', 'visa type', 'immigration document'] },
  { key: 'shareCode', label: 'Share code', group: 'Right to work', aliases: ['share code', 'sharecode', 'rtw share code'] },
  { key: 'rtwChecked', label: 'Right to work checked on', group: 'Right to work', aliases: ['rtw checked', 'rtw check date', 'right to work checked', 'right to work check date', 'date checked', 'rtw date'] },
  { key: 'rtwExpires', label: 'Right to work expires', group: 'Right to work', aliases: ['rtw expiry', 'rtw expires', 'rtw expiry date', 'right to work expiry', 'visa expiry', 'visa expiry date', 'expiry date', 'permission expiry'] },
  { key: 'jobTypes', label: 'Job types / skills', group: 'Work', aliases: ['job types', 'job type', 'skills', 'roles', 'categories', 'cleared for', 'job categories'] },
  { key: 'client', label: 'Client they work at (ongoing)', group: 'Work', aliases: ['client', 'client name', 'company', 'current client', 'placement', 'assignment', 'customer', 'working at', 'site client'] },
  { key: 'site', label: 'Client site', group: 'Work', aliases: ['site', 'site name', 'location', 'branch'] },
  { key: 'startDate', label: 'Started at client', group: 'Work', aliases: ['start date', 'started', 'assignment start', 'placement start', 'start'] },
  { key: 'jobTitle', label: 'Role at client', group: 'Work', aliases: ['job title', 'position', 'role', 'assignment role'] },
  { key: 'ref', label: 'Their ID in the old system', group: 'Work', aliases: ['id', 'ref', 'reference', 'candidate id', 'candidate ref', 'worker id', 'employee id', 'payroll number', 'payroll no', 'kisrec id', 'temp id', 'candidate number'] },
];

export type Mapping = Partial<Record<ImportField, number>>;

const norm = (h: string) => h.replace(/^﻿/, '').trim().toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' ');

/** Best guess at which column is which, from the header row. Each column is used at most once. */
export function guessMapping(head: string[]): Mapping {
  const h = head.map(norm);
  const used = new Set<number>();
  const m: Mapping = {};
  for (const f of FIELDS) {
    const i = h.findIndex((x, j) => !used.has(j) && f.aliases.includes(x));
    if (i >= 0) { m[f.key] = i; used.add(i); }
  }
  // Looser second pass: header contains the alias (e.g. "Candidate Mobile Number").
  for (const f of FIELDS) {
    if (m[f.key] != null || f.key === 'full' || f.key === 'account' || f.key === 'ref') continue;
    const i = h.findIndex((x, j) => !used.has(j) && f.aliases.some((a) => a.length > 3 && x.includes(a)));
    if (i >= 0) { m[f.key] = i; used.add(i); }
  }
  return m;
}

/** Dates as UK systems export them: 31/01/2024, 31-01-24, 2024-01-31, 31 Jan 2024, or an Excel day number. */
export function parseDate(v: string): string | null {
  const s = (v || '').trim();
  if (!s) return null;
  let y: number, mo: number, d: number;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})\b/))) {
    d = +m[1]; mo = +m[2]; y = +m[3];
    if (m[3].length === 2) y += y > (new Date().getFullYear() % 100) + 1 ? 1900 : 2000;
  } else if ((m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/))) {
    d = +m[1]; y = +m[3];
    mo = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
  } else if (/^\d{5}$/.test(s)) {
    const dt = new Date(Date.UTC(1899, 11, 30) + +s * 864e5);
    return dt.toISOString().slice(0, 10);
  } else return null;
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2100)) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

export const cleanNi = (v: string) => (v || '').replace(/\s+/g, '').toUpperCase();
export const niOk = (v: string) => /^[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\d{6}[A-D]$/.test(v) && !/^(BG|GB|NK|KN|TN|NT|ZZ)/.test(v);

export function normaliseJobType(s: string): string | null {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  if (/flt|forklift|counterbalance|reach truck/.test(t)) return 'FLT counterbalance';
  if (/driv|hgv|van|class [12]|c\+e|7\.5/.test(t)) return 'Driving';
  if (/warehouse|picker|packer|operative|pick|pack/.test(t)) return 'Warehouse';
  if (/production|line|factory|food|machine/.test(t)) return 'Production';
  if (/clean|hygiene/.test(t)) return 'Cleaning';
  return null;
}

/** British/Irish passport route, or a share code (anyone else with a time-limited or settled status). */
export function rtwRoute(type: string, shareCode: string): 'british_irish' | 'share_code' | null {
  const t = (type || '').toLowerCase();
  if (shareCode.trim() || /share|visa|brp|settled|evisa|e-visa|biometric|eu ?ss|immigration|status|permit/.test(t)) return 'share_code';
  if (/brit|irish|\buk\b|passport|birth cert|citizen/.test(t)) return 'british_irish';
  return null;
}

export type ImportRecord = {
  row: number;            // line in the file, for messages
  first: string; last: string; mobile: string; email: string; dob: string | null;
  address1: string; address2: string; town: string; postcode: string; nationality: string;
  ni: string; bankName: string; sortCode: string; account: string;
  rtwRoute: 'british_irish' | 'share_code' | null; shareCode: string; rtwChecked: string | null; rtwExpires: string | null;
  jobTypes: string[]; client: string; site: string; startDate: string | null; jobTitle: string; ref: string;
};

export type Checked = ImportRecord & { problems: string[]; warnings: string[]; e164: string | null };

const cap = (s: string, n = 120) => s.replace(/\s+/g, ' ').trim().slice(0, n);
const titleCase = (s: string) => (s === s.toUpperCase() || s === s.toLowerCase() ? s.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (c) => c.toUpperCase()) : s);

/** Turns one CSV row into a record, with problems (row is skipped) and warnings (row is added without that detail). */
export function readRow(r: string[], m: Mapping, line: number): Checked {
  const g = (k: ImportField) => (m[k] != null ? cap(r[m[k]!] ?? '', 300) : '');
  let first = g('first'), last = g('last');
  if (!first && !last && g('full')) {
    const full = g('full');
    if (full.includes(',')) { const [l, f] = full.split(',', 2); last = l.trim(); first = (f ?? '').trim(); }
    else { const p = full.split(' '); first = p.shift() || ''; last = p.join(' '); }
  }
  first = titleCase(cap(first, 60)); last = titleCase(cap(last, 60));
  const problems: string[] = [], warnings: string[] = [];
  const mobile = g('mobile');
  const e164 = toE164(mobile);
  if (!first) problems.push('No name');
  if (!e164) problems.push(mobile ? 'Not a UK mobile' : 'No mobile');

  const niRaw = cleanNi(g('ni'));
  const ni = niRaw && niOk(niRaw) ? niRaw : '';
  if (niRaw && !ni) warnings.push('NI number not valid, left off');

  let sortCode = g('sortCode').replace(/\D/g, ''), account = g('account').replace(/\D/g, '');
  if (account.length === 7) account = '0' + account;
  if (sortCode.length === 5) sortCode = '0' + sortCode; // Excel drops the leading 0
  const anyBank = sortCode || account;
  if (anyBank && (sortCode.length !== 6 || account.length !== 8)) { warnings.push('Bank details incomplete, left off'); sortCode = ''; account = ''; }

  const dobRaw = g('dob'), dob = parseDate(dobRaw);
  if (dobRaw && !dob) warnings.push('Date of birth not understood');
  const chkRaw = g('rtwChecked'), expRaw = g('rtwExpires');
  const rtwChecked = parseDate(chkRaw), rtwExpires = parseDate(expRaw);
  if (chkRaw && !rtwChecked) warnings.push('RTW check date not understood');
  if (expRaw && !rtwExpires && !/no|n\/a|none|indefinite|unlimited|settled/i.test(expRaw)) warnings.push('RTW expiry not understood');
  const shareCode = g('shareCode').replace(/\s+/g, '').toUpperCase().slice(0, 12);
  const route = rtwRoute(g('rtwType'), shareCode);
  const startRaw = g('startDate'), startDate = parseDate(startRaw);
  if (startRaw && !startDate) warnings.push('Start date not understood, today used');
  const email = g('email').toLowerCase();

  return {
    row: line, first, last: last || '-', mobile, e164, email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email.slice(0, 120) : '',
    dob, address1: g('address1'), address2: g('address2'), town: cap(g('town'), 80), postcode: g('postcode').toUpperCase(), nationality: cap(g('nationality'), 60),
    ni, bankName: cap(g('bankName') || `${first} ${last}`.trim(), 70), sortCode, account,
    rtwRoute: route, shareCode, rtwChecked, rtwExpires,
    jobTypes: [...new Set(g('jobTypes').split(/[;|/,]/).map(normaliseJobType).filter(Boolean) as string[])],
    client: cap(g('client'), 80), site: cap(g('site'), 60), startDate, jobTitle: cap(g('jobTitle'), 80), ref: cap(g('ref'), 60),
    problems, warnings,
  };
}
