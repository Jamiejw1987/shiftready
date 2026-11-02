import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseApplication, takeApplication } from '@/lib/applications';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const SOURCES = ['cv-library'];

async function keyOk(db: ReturnType<typeof createAdminClient>, given: string | null) {
  if (!given) return false;
  const { data } = await db.from('app_secrets').select('value').eq('name', 'apply_key').maybeSingle();
  if (!data?.value) return false;
  const a = Buffer.from(given), b = Buffer.from(data.value);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Lets you (or CV-Library) check the address works. */
export async function GET(req: NextRequest, { params }: { params: { source: string } }) {
  const db = createAdminClient();
  if (!SOURCES.includes(params.source) || !(await keyOk(db, req.nextUrl.searchParams.get('key')))) return NextResponse.json({ result: 'error', message: 'Unknown address' }, { status: 404 });
  return NextResponse.json({ result: 'ready' });
}

/**
 * Job board DirectApply: the board sends each application here instead of emailing it.
 * The board needs {"result":"success"} back within 5 seconds, so this only answers success once the application is saved.
 */
export async function POST(req: NextRequest, { params }: { params: { source: string } }) {
  const db = createAdminClient();
  if (!SOURCES.includes(params.source) || !(await keyOk(db, req.nextUrl.searchParams.get('key')))) return NextResponse.json({ result: 'error', message: 'Unknown address' }, { status: 404 });

  let body: Record<string, unknown> = {};
  const type = req.headers.get('content-type') || '';
  try {
    if (type.includes('multipart/form-data') || type.includes('application/x-www-form-urlencoded')) {
      const form = await req.formData();
      for (const [k, v] of form.entries()) {
        if (typeof v === 'string') body[k] = v;
        else if (v.size > 0 && v.size < 15 * 1024 * 1024) body.cv = { filename: v.name, content: Buffer.from(await v.arrayBuffer()).toString('base64') };
      }
    } else {
      const text = await req.text();
      if (text.length > 25 * 1024 * 1024) return NextResponse.json({ result: 'error', message: 'Too large' }, { status: 413 });
      body = JSON.parse(text);
    }
  } catch {
    return NextResponse.json({ result: 'error', message: 'Couldn’t read the application' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ result: 'error', message: 'Couldn’t read the application' }, { status: 400 });

  const r = await takeApplication(db, params.source, parseApplication(body, req.nextUrl.searchParams));
  if (!r.id) return NextResponse.json({ result: 'error', message: 'Couldn’t save the application' }, { status: 500 });
  return NextResponse.json({ result: 'success', id: r.id });
}
