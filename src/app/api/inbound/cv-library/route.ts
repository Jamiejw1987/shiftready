import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { takeApplication } from '@/lib/applications';
import { isCvLibraryApplication, parseCvLibraryEmail, type PostmarkInbound } from '@/lib/cvLibraryEmail';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * CV-Library application emails, forwarded from Outlook to Postmark's inbound address.
 * Postmark posts each email here as JSON. Set the inbound webhook in Postmark to:
 *   APP_URL/api/inbound/cv-library?key=<apply_key>
 * (same key as the DirectApply address shown on the Registrations page).
 *
 * Postmark retries anything that isn't a 200, so emails we deliberately ignore still get a 200.
 */
async function keyOk(db: ReturnType<typeof createAdminClient>, given: string | null) {
  if (!given) return false;
  const { data } = await db.from('app_secrets').select('value').eq('name', 'apply_key').maybeSingle();
  if (!data?.value) return false;
  const a = Buffer.from(given), b = Buffer.from(data.value);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  const db = createAdminClient();
  if (!(await keyOk(db, req.nextUrl.searchParams.get('key')))) return NextResponse.json({ result: 'error' }, { status: 404 });
  return NextResponse.json({ result: 'ready' });
}

export async function POST(req: NextRequest) {
  const db = createAdminClient();
  if (!(await keyOk(db, req.nextUrl.searchParams.get('key')))) return NextResponse.json({ result: 'error' }, { status: 404 });

  let m: PostmarkInbound;
  try {
    m = await req.json();
  } catch {
    return NextResponse.json({ result: 'ignored', reason: 'Not JSON' });
  }

  // Only genuine CV-Library applications. Anything else forwarded by mistake is dropped, so nobody is contacted.
  if (!isCvLibraryApplication(m)) return NextResponse.json({ result: 'ignored', reason: 'Not a CV-Library application' });

  const a = await parseCvLibraryEmail(m);
  if (!a.email && !a.mobile) return NextResponse.json({ result: 'ignored', reason: 'No email or phone found' });

  const r = await takeApplication(db, 'cv-library', a);
  if (!r.id) return NextResponse.json({ result: 'error', message: 'Couldn’t save the application' }, { status: 500 });
  return NextResponse.json({ result: 'success', id: r.id, outcome: r.outcome });
}
