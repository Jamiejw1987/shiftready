import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { plainText, segmentInfo } from './smsText';
import { appUrl } from './texts';

export { plainText, segmentInfo };

/**
 * Messaging through Twilio: WhatsApp first where it's set up, plain text otherwise.
 *
 * - Not configured at all: "dry-run" mode. Every message is recorded in the messages table but nothing is sent.
 * - Texts (SMS) need TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER.
 * - WhatsApp also needs TWILIO_WHATSAPP_FROM plus a template id per message type (WA_TEMPLATE_*).
 *   If a temp turns out not to have WhatsApp, Twilio reports it back to /api/sms/status and the
 *   same message is re-sent as a text automatically. That temp then gets texts from then on.
 */

export function smsConfigured(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
}
export function whatsappConfigured(): boolean {
  return smsConfigured() && Boolean(process.env.TWILIO_WHATSAPP_FROM);
}

export type WaTemplate = 'welcome' | 'offer' | 'reminder' | 'promoted';
const TEMPLATE_ENV: Record<WaTemplate, string> = {
  welcome: 'WA_TEMPLATE_WELCOME', offer: 'WA_TEMPLATE_OFFER', reminder: 'WA_TEMPLATE_REMINDER', promoted: 'WA_TEMPLATE_PROMOTED',
};
const templateSid = (t: WaTemplate) => process.env[TEMPLATE_ENV[t]] || '';

/** WhatsApp template values can't contain line breaks, tabs or long runs of spaces, or be empty. */
const waVar = (v: string) => (v || '-').replace(/[\r\n\t]+/g, ', ').replace(/ {4,}/g, ' ').trim().slice(0, 500) || '-';

type TwilioResult = { status: string; providerId: string | null; error: string | null; errorCode: string | null };

async function twilioSend(params: Record<string, string>): Promise<TwilioResult> {
  try {
    const sid = process.env.TWILIO_ACCOUNT_SID!;
    const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...params, StatusCallback: `${appUrl()}/api/sms/status` }),
      cache: 'no-store',
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) return { status: json.status || 'queued', providerId: json.sid ?? null, error: null, errorCode: null };
    return { status: 'failed', providerId: null, error: json.message || `Twilio error ${res.status}`, errorCode: json.code ? String(json.code) : null };
  } catch (e) {
    return { status: 'failed', providerId: null, error: e instanceof Error ? e.message : 'Network error', errorCode: null };
  }
}

type SendArgs = {
  db: SupabaseClient;
  to: string;
  body: string;
  kind: string;
  tempId?: string | null;
  offerId?: string | null;
  sentBy?: string | null;
};

/** Sends one plain text (SMS) and records it. Never throws: failures are recorded with status "failed". */
export async function sendSms({ db, to, body, kind, tempId = null, offerId = null, sentBy = null }: SendArgs) {
  const text = plainText(body);
  const { segments } = segmentInfo(text);
  const r: TwilioResult = smsConfigured()
    ? await twilioSend({ To: to, From: process.env.TWILIO_FROM_NUMBER!, Body: text })
    : { status: 'dry-run', providerId: null, error: null, errorCode: null };
  await db.from('messages').insert({
    temp_id: tempId, offer_id: offerId, to_number: to, direction: 'out', channel: 'sms', kind, body: text, segments,
    provider_id: r.providerId, status: r.status, error: r.error, sent_by: sentBy,
  });
  return { ok: r.status !== 'failed', status: r.status, error: r.error, channel: 'sms' as const };
}

type TempArgs = Omit<SendArgs, 'to' | 'tempId'> & {
  temp: { id: string; mobile: string };
  /** The WhatsApp template to use, and its values in order ({{1}}, {{2}}, ...). Leave out for messages with no template. */
  wa?: { template: WaTemplate; vars: string[] } | null;
};

/**
 * Sends a message to a temp on WhatsApp where possible, otherwise as a text.
 * Template messages go by WhatsApp unless we already know the temp hasn't got it.
 * Messages with no template (confirmations, cancellations) go by WhatsApp only while the temp has
 * messaged us there in the last 24 hours, which is WhatsApp's rule; otherwise by text.
 */
export async function sendToTemp({ db, temp, body, kind, offerId = null, sentBy = null, wa = null }: TempArgs) {
  if (whatsappConfigured()) {
    const { data: t } = await db.from('temps').select('wa_status').eq('id', temp.id).maybeSingle();
    if (t?.wa_status !== 'no') {
      let params: Record<string, string> | null = null;
      if (wa && templateSid(wa.template)) {
        params = {
          ContentSid: templateSid(wa.template),
          ContentVariables: JSON.stringify(Object.fromEntries(wa.vars.map((v, i) => [String(i + 1), waVar(v)]))),
        };
      } else {
        const since = new Date(Date.now() - 23.5 * 3600e3).toISOString();
        const { count } = await db.from('messages').select('id', { count: 'exact', head: true })
          .eq('temp_id', temp.id).eq('direction', 'in').eq('channel', 'whatsapp').gte('created_at', since);
        if (count) params = { Body: body };
      }
      if (params) {
        const r = await twilioSend({ To: `whatsapp:${temp.mobile}`, From: `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`, ...params });
        await db.from('messages').insert({
          temp_id: temp.id, offer_id: offerId, to_number: temp.mobile, direction: 'out', channel: 'whatsapp', kind,
          body: plainText(body), fallback_body: plainText(body), fell_back: r.status === 'failed',
          provider_id: r.providerId, status: r.status, error: r.error, sent_by: sentBy,
        });
        if (r.status !== 'failed') return { ok: true, status: r.status, error: null, channel: 'whatsapp' as const };
        if (r.errorCode === '63003') await db.from('temps').update({ wa_status: 'no' }).eq('id', temp.id);
        // WhatsApp refused it straight away: fall through and send it as a text instead.
      }
    }
  }
  return sendSms({ db, to: temp.mobile, body, kind, tempId: temp.id, offerId, sentBy });
}

/** Runs many sends with limited concurrency. */
export async function sendMany<T>(items: T[], send: (item: T) => Promise<{ ok: boolean }>, concurrency = 8) {
  let i = 0, sent = 0, failed = 0;
  async function worker() {
    while (i < items.length) {
      const r = await send(items[i++]);
      r.ok ? sent++ : failed++;
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return { sent, failed };
}
