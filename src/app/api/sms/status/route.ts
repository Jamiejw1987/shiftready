import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendSms } from '@/lib/sms';
import { validTwilioRequest } from '@/lib/twilioSignature';

/**
 * Twilio reports delivery here for every message we send.
 * If a WhatsApp message can't be delivered (the temp hasn't got WhatsApp, or it was refused),
 * the same message is sent again as a plain text, once. Temps without WhatsApp are remembered,
 * so their next messages go straight by text.
 */

// 63003: number isn't on WhatsApp. 63024: not a valid WhatsApp recipient.
const NOT_ON_WHATSAPP = ['63003', '63024'];

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => (params[k] = String(v)));
  if (!validTwilioRequest(req, params)) return new NextResponse('Forbidden', { status: 403 });

  const sid = params.MessageSid, status = params.MessageStatus, code = params.ErrorCode || null;
  if (!sid || !status) return new NextResponse(null, { status: 204 });
  const db = createAdminClient();
  const { data: m } = await db.from('messages').select('id,channel,temp_id,offer_id,kind,to_number,fallback_body,fell_back,sent_by').eq('provider_id', sid).maybeSingle();
  if (!m) return new NextResponse(null, { status: 204 });

  await db.from('messages').update({ status, error: code ? `Twilio error ${code}` : null }).eq('id', m.id);

  if (m.channel === 'whatsapp' && m.temp_id) {
    if (status === 'delivered' || status === 'read') {
      await db.from('temps').update({ wa_status: 'yes' }).eq('id', m.temp_id);
    } else if ((status === 'failed' || status === 'undelivered') && !m.fell_back && m.fallback_body && m.to_number) {
      // Claim the fallback first so a repeated callback can't send the text twice.
      const { data: claimed } = await db.from('messages').update({ fell_back: true }).eq('id', m.id).eq('fell_back', false).select('id');
      if (claimed?.length) {
        if (code && NOT_ON_WHATSAPP.includes(code)) await db.from('temps').update({ wa_status: 'no' }).eq('id', m.temp_id);
        await sendSms({ db, to: m.to_number, body: m.fallback_body, kind: m.kind, tempId: m.temp_id, offerId: m.offer_id, sentBy: m.sent_by });
      }
    }
  }
  return new NextResponse(null, { status: 204 });
}
