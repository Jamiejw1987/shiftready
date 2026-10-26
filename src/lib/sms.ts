import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { plainText, segmentInfo } from './smsText';

export { plainText, segmentInfo };

/**
 * Text messaging through Twilio. If Twilio isn't configured the app runs in dry-run mode:
 * every text is still recorded in the messages table (status "dry-run") but nothing is sent.
 */

export function smsConfigured(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
}

type SendArgs = {
  db: SupabaseClient;
  to: string;
  body: string;
  kind: string;
  tempId?: string | null;
  sentBy?: string | null;
};

/** Sends one text and records it. Never throws: failures are recorded with status "failed". */
export async function sendSms({ db, to, body, kind, tempId = null, sentBy = null }: SendArgs) {
  const text = plainText(body);
  const { segments } = segmentInfo(text);
  let status = 'dry-run';
  let providerId: string | null = null;
  let error: string | null = null;

  if (smsConfigured()) {
    try {
      const sid = process.env.TWILIO_ACCOUNT_SID!;
      const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM_NUMBER!, Body: text }),
        cache: 'no-store',
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        status = json.status || 'queued';
        providerId = json.sid ?? null;
      } else {
        status = 'failed';
        error = json.message || `Twilio error ${res.status}`;
      }
    } catch (e) {
      status = 'failed';
      error = e instanceof Error ? e.message : 'Network error';
    }
  }

  await db.from('messages').insert({
    temp_id: tempId,
    to_number: to,
    direction: 'out',
    kind,
    body: text,
    segments,
    provider_id: providerId,
    status,
    error,
    sent_by: sentBy,
  });
  return { ok: status !== 'failed', status, error };
}

/** Sends many texts with limited concurrency. */
export async function sendMany(items: SendArgs[], concurrency = 8) {
  const results: Awaited<ReturnType<typeof sendSms>>[] = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const item = items[i++];
      results.push(await sendSms(item));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return { sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
}
