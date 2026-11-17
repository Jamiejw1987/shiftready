import { NextResponse, type NextRequest } from 'next/server';
import { requireStaff, audit } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadFull } from '@/lib/inductionLoad';
import { buildSignedPdf } from '@/lib/inductionPdf';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** The signed induction as one PDF, for the office to keep or send to the client. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { supabase, profile } = await requireStaff();
  const { data: ok } = await supabase.from('temp_inductions').select('id').eq('id', params.id).maybeSingle();
  if (!ok) return new NextResponse('Not found', { status: 404 });
  const db = createAdminClient();
  const f = await loadFull(db, params.id);
  if (!f) return new NextResponse('Not found', { status: 404 });
  const ids = [f.induction.checked_by, f.induction.site_by_staff, f.induction.sent_by].filter(Boolean) as string[];
  const [{ data: staff }, { data: sup }] = await Promise.all([
    ids.length ? db.from('profiles').select('id,full_name').in('id', ids) : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    f.induction.site_by_supervisor ? db.from('site_supervisors').select('full_name').eq('id', f.induction.site_by_supervisor).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const nm = (id: string | null) => (staff ?? []).find((s) => s.id === id)?.full_name ?? null;
  const bytes = await buildSignedPdf(db, {
    ...f, checkedByName: nm(f.induction.checked_by), sentByName: nm(f.induction.sent_by),
    siteByName: sup?.full_name ? `${sup.full_name} (site login)` : nm(f.induction.site_by_staff),
  });
  await audit(supabase, profile.id, 'induction.pdf', `Downloaded the signed ${f.pack.name} for ${f.temp.first_name} ${f.temp.last_name}`);
  const file = `${f.pack.name} - ${f.temp.first_name} ${f.temp.last_name}.pdf`.replace(/[^\w .()-]+/g, '');
  return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${file}"`, 'Cache-Control': 'no-store' } });
}
