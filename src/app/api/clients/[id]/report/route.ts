import { NextResponse, type NextRequest } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { clientAudit } from '@/lib/clients';
import { clientReport, reportCsv, reportRange } from '@/lib/clientReport';

export const dynamic = 'force-dynamic';

/** Spreadsheet of a client's report, for the office to check and share. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { supabase, profile } = await requireStaff();
  const { data: c } = await supabase.from('clients').select('id,name').eq('id', params.id).maybeSingle();
  if (!c) return new NextResponse('Not found', { status: 404 });
  const { from, to } = reportRange(req.nextUrl.searchParams.get('from') ?? undefined, req.nextUrl.searchParams.get('to') ?? undefined);
  const r = await clientReport(supabase, c.id, from, to);
  await clientAudit(supabase, { actor: profile.id, action: 'client.report_downloaded', clientId: c.id, entity: 'client', entityId: c.id, detail: `${profile.full_name} downloaded the ${c.name} report for ${from} to ${to}` });
  const slug = c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return new NextResponse('﻿' + reportCsv(r.lines), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${slug}-${from}-to-${to}.csv"`, 'Cache-Control': 'no-store' },
  });
}
