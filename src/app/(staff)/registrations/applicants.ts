import { parseCSV } from '../temps/csv';
import { toE164 } from '@/lib/phone';

export type Applicant = { first: string; last: string; mobile: string; e164: string | null };

const MOB = ['mobile', 'mobile number', 'mobile phone', 'phone', 'phone number', 'telephone', 'tel', 'mobile no', 'contact number'];
const FIRST = ['first name', 'firstname', 'forename', 'first'];
const LAST = ['surname', 'last name', 'lastname', 'last'];
const FULL = ['name', 'full name', 'candidate name', 'candidate', 'applicant', 'applicant name'];

const split = (full: string) => {
  const c = full.indexOf(',');
  if (c > 0) return { first: full.slice(c + 1).trim(), last: full.slice(0, c).trim() }; // "Smith, Dan"
  const p = full.trim().split(/\s+/);
  return { first: p.shift() || '', last: p.join(' ') };
};

/**
 * Reads applicants from a CSV export (Indeed, job boards, KISREC) or from pasted lines like
 * "Dan Smith, 07700 900123". Any column order works as long as there's a name and a UK mobile.
 */
export function parseApplicants(text: string): Applicant[] {
  const rows = parseCSV(text.replace(/\t/g, ','));
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase().replace(/^﻿/, ''));
  const iMob = head.findIndex((h) => MOB.includes(h));
  if (iMob >= 0) {
    const iF = head.findIndex((h) => FIRST.includes(h)), iL = head.findIndex((h) => LAST.includes(h)), iN = head.findIndex((h) => FULL.includes(h));
    return rows.slice(1).map((r) => {
      const g = (i: number) => (i >= 0 ? (r[i] || '').trim() : '');
      const n = g(iF) ? { first: g(iF), last: g(iL) } : split(g(iN));
      return { ...n, mobile: g(iMob), e164: toE164(g(iMob)) };
    });
  }
  // No header: each line is a name and a mobile, in any order, separated by commas, tabs or spaces.
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const m = line.match(/(?:\+?44[\s-]?|0)?7\d{3}[\s-]?\d{3}[\s-]?\d{3}/) || line.match(/\+?[\d][\d\s-]{8,}\d/);
    const mobile = m ? m[0].trim() : '';
    const name = (m ? line.replace(m[0], ' ') : line).replace(/["\t]/g, ' ').replace(/^[\s,;]+|[\s,;]+$/g, '').replace(/\s+/g, ' ');
    return { ...split(name), mobile, e164: toE164(mobile) };
  });
}
