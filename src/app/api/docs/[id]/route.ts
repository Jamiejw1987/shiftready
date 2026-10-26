import { NextResponse, type NextRequest } from 'next/server';
import { requireStaff, audit } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { DOC_KIND_LABEL, type DocKindFile } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/** Opens a stored document for signed-in staff through a 60-second link, and logs who looked. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { supabase, profile } = await requireStaff();
  const { data: d } = await supabase.from('temp_documents').select('path,kind,temps(first_name,last_name)').eq('id', params.id).maybeSingle();
  if (!d) return new NextResponse('Not found', { status: 404 });
  const { data } = await createAdminClient().storage.from('documents').createSignedUrl(d.path, 60);
  if (!data?.signedUrl) return new NextResponse('File missing', { status: 404 });
  const t = d.temps as unknown as { first_name: string; last_name: string } | null;
  await audit(supabase, profile.id, 'temp.document_viewed', `Opened ${t?.first_name} ${t?.last_name}'s ${DOC_KIND_LABEL[d.kind as DocKindFile] ?? 'document'}`);
  return NextResponse.redirect(data.signedUrl);
}
