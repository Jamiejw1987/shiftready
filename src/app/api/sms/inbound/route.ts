import { NextResponse, type NextRequest } from 'next/server';
import { validTwilioRequest } from '@/lib/twilioSignature';
import { handleInbound } from '@/lib/inbound';

const twiml = () => new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', { headers: { 'Content-Type': 'text/xml' } });

/** Twilio calls this when a temp replies by text or WhatsApp. The logic lives in lib/inbound.ts. */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => (params[k] = String(v)));
  if (!validTwilioRequest(req, params)) return new NextResponse('Forbidden', { status: 403 });
  await handleInbound(params);
  return twiml();
}
