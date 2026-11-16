import 'server-only';
import { NextResponse } from 'next/server';
import type { Assignment } from '@/app/(staff)/ongoing/Ongoing';

const q = (v: string | null | undefined) => { const s = v ?? ''; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const local = (m: string | null | undefined) => (m?.startsWith('+44') ? '0' + m.slice(3) : m ?? '');

/** Ongoing workers as a spreadsheet: who's working where, since when, and who has finished. */
export function ongoingCsv(list: Assignment[], today: string, filename: string) {
  const weeks = (from: string, to: string) => Math.max(0, Math.floor((Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / (7 * 864e5)));
  const head = ['Client', 'Site', 'Worker', 'Mobile', 'Role', 'Started', 'Ended', 'Status', 'Weeks'];
  const rows = list.map((a) => {
    const current = !a.end_date || a.end_date >= today;
    return [a.client_name, a.site_name, a.temp_name, local(a.mobile), a.job_title, a.start_date, a.end_date ?? '', current ? 'Ongoing' : 'Finished',
      String(weeks(a.start_date, current ? today : a.end_date!))];
  });
  return new NextResponse('﻿' + [head, ...rows].map((r) => r.map(q).join(',')).join('\r\n'), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' },
  });
}
