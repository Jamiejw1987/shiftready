import 'server-only';
import { createHmac, timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';
import { appUrl } from './texts';

const sign = (token: string, url: string, params: Record<string, string>) =>
  createHmac('sha1', token)
    .update(Buffer.from(url + Object.keys(params).sort().map((k) => k + params[k]).join(''), 'utf-8'))
    .digest('base64');

/**
 * Checks a request really came from Twilio (signed with your Auth Token).
 * Twilio signs the exact address it called, so we accept the signature for APP_URL or for the
 * address the request actually arrived on. That way replies keep working if the app's address
 * changes before the webhook in Twilio is updated (or the other way round).
 */
export function validTwilioRequest(req: NextRequest, params: Record<string, string>) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  const sig = req.headers.get('x-twilio-signature');
  if (!token || !sig) return false;
  const path = req.nextUrl.pathname + req.nextUrl.search;
  const hosts = [req.headers.get('x-forwarded-host'), req.headers.get('host')]
    .flatMap((h) => (h ? h.split(',') : []))
    .map((h) => h.trim())
    .filter(Boolean);
  const bases = new Set([appUrl(), ...hosts.map((h) => `https://${h}`)]);
  const b = Buffer.from(sig);
  for (const base of bases) {
    const a = Buffer.from(sign(token, base + path, params));
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  console.warn('Twilio signature did not match', { tried: [...bases], path });
  return false;
}
