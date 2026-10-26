import { createHmac, timingSafeEqual } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendSms } from '@/lib/sms';
import { appUrl, OPTED_IN_REPLY, OPTED_OUT_REPLY } from '@/lib/texts';

/**
 * Twilio calls this when a temp replies to a text (set it as the number's "A message comes in" webhook).
 * YES / START opts them in. STOP and similar opts them out. Everything is logged.
 */

const STOP = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'OPTOUT', 'OPT OUT'];
const START = ['YES', 'Y', 'START', 'UNSTOP', 'OPTIN', 'OPT IN', 'YES PLEASE'];

function validSignature(req: NextRequest, params: Record<string, string>) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  const sig = req.headers.get('x-twilio-signature');
  if (!token || !sig) return false;
  const url = appUrl() + req.nextUrl.pathname;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const expected = createHmac('sha1', token).update(Buffer.from(data, 'utf-8')).digest('base64');
  const a = Buffer.from(expected), b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

const twiml = () => new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', { headers: { 'Content-Type': 'text/xml' } });

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => (params[k] = String(v)));
  if (!validSignature(req, params)) return new NextResponse('Forbidden', { status: 403 });

  const from = params.From || '';
  const body = (params.Body || '').trim();
  const word = body.toUpperCase().replace(/[^A-Z ]/g, '').trim();
  const db = createAdminClient();
  const { data: t } = await db.from('temps').select('id,first_name,last_name,status').eq('mobile', from).maybeSingle();

  await db.from('messages').insert({ temp_id: t?.id ?? null, from_number: from, direction: 'in', kind: 'reply', body: body.slice(0, 1000), status: 'received', provider_id: params.MessageSid ?? null });
  if (!t) return twiml();

  if (STOP.includes(word)) {
    if (t.status !== 'out') {
      await db.from('temps').update({ status: 'out', opted_out_at: new Date().toISOString() }).eq('id', t.id);
      await db.from('audit_log').insert({ actor: null, action: 'temp.opted_out', detail: `${t.first_name} ${t.last_name} opted out by text (${word})` });
      await sendSms({ db, to: from, body: OPTED_OUT_REPLY, kind: 'system', tempId: t.id });
    }
  } else if (START.includes(word)) {
    if (t.status === 'pending' || t.status === 'out') {
      await db.from('temps').update({ status: 'active', opted_in_at: new Date().toISOString(), opted_out_at: null }).eq('id', t.id);
      await db.from('audit_log').insert({ actor: null, action: 'temp.opted_in', detail: `${t.first_name} ${t.last_name} opted in by text (${word})` });
      await sendSms({ db, to: from, body: OPTED_IN_REPLY, kind: 'system', tempId: t.id });
    }
  }
  return twiml();
}
