import { NextResponse, type NextRequest } from 'next/server';
import { requireStaff, audit } from '@/lib/auth';
import { monday, toCsv, weekReport } from '@/lib/reports';

export const dynamic = 'force-dynamic';

/** CSV of one week's shifts. Admins only. */
export async function GET(req: NextRequest) {
  const { supabase, profile } = await requireStaff({ admin: true });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const w = req.nextUrl.searchParams.get('w');
  const start = monday(w && /^\d{4}-\d{2}-\d{2}$/.test(w) ? w : today);
  const r = await weekReport(supabase, start);
  await audit(supabase, profile.id, 'report.downloaded', `Downloaded the shift report for the week of ${start}`);
  return new NextResponse('﻿' + toCsv(r.lines), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="shiftready-week-${start}.csv"`, 'Cache-Control': 'no-store' },
  });
}
