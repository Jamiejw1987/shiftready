import 'server-only';
import { createHmac, timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';
import { appUrl } from './texts';

/** Checks a request really came from Twilio (signed with your Auth Token). */
export function validTwilioRequest(req: NextRequest, params: Record<string, string>) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  const sig = req.headers.get('x-twilio-signature');
  if (!token || !sig) return false;
  const url = appUrl() + req.nextUrl.pathname + req.nextUrl.search;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const expected = createHmac('sha1', token).update(Buffer.from(data, 'utf-8')).digest('base64');
  const a = Buffer.from(expected), b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}
