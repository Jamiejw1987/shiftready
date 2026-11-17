import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadFull } from '@/lib/inductionLoad';
import { buildDayOnePdf } from '@/lib/inductionPdf';
import { currentSupervisor } from '@/lib/siteAuth';
import { supervisorCanSee } from '@/lib/siteData';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** The day-one paper sheet(s) with the worker's details printed, ready to sign on site. Office staff, or a site login for today's temps. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  let allowed = false;
  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (auth.user) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel === 'aal2') {
      const { data: me } = await supabase.from('profiles').select('active').eq('id', auth.user.id).maybeSingle();
      allowed = !!me?.active;
    }
  }
  if (!allowed) {
    const sup = await currentSupervisor();
    allowed = !!sup && (await supervisorCanSee(sup, params.id));
  }
  if (!allowed) return new NextResponse('Not allowed', { status: 403 });
  const db = createAdminClient();
  const f = await loadFull(db, params.id);
  if (!f || f.induction.cancelled_at) return new NextResponse('Not found', { status: 404 });
  const bytes = await buildDayOnePdf(db, f);
  const file = `Day one - ${f.temp.first_name} ${f.temp.last_name}.pdf`.replace(/[^\w .()-]+/g, '');
  return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${file}"`, 'Cache-Control': 'no-store' } });
}
