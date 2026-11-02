import { NextResponse, type NextRequest } from 'next/server';
import { requireStaff, audit } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/** Opens an applicant's CV for signed-in staff through a 60-second link, and logs who looked. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { supabase, profile } = await requireStaff();
  const { data: a } = await supabase.from('job_applications').select('cv_path,first_name,last_name').eq('id', params.id).maybeSingle();
  if (!a?.cv_path) return new NextResponse('No CV', { status: 404 });
  const { data } = await createAdminClient().storage.from('documents').createSignedUrl(a.cv_path, 60);
  if (!data?.signedUrl) return new NextResponse('File missing', { status: 404 });
  await audit(supabase, profile.id, 'application.cv_viewed', `Opened ${a.first_name} ${a.last_name}'s CV`);
  return NextResponse.redirect(data.signedUrl);
}
