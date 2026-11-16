import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { loadAssignments } from '@/lib/ongoing';
import { ongoingCsv } from '@/lib/ongoingCsv';

export const dynamic = 'force-dynamic';

/** This client's ongoing workers (current and finished) as a CSV. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { supabase } = await requireStaff();
  const { data: c } = await supabase.from('clients').select('id,name').eq('id', params.id).maybeSingle();
  if (!c) return new NextResponse('Not found', { status: 404 });
  const { list } = await loadAssignments(supabase, { clientId: c.id });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  return ongoingCsv(list, today, `${c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-ongoing-workers.csv`);
}
