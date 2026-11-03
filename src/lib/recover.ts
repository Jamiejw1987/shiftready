import 'server-only';
import { createAdminClient } from './supabase/admin';
import { handleInbound } from './inbound';

type TwilioMsg = { sid: string; from: string; to: string; body: string; direction: string; date_sent: string | null; date_created: string };
type ListPage = { messages?: TwilioMsg[]; next_page_uri?: string | null; message?: string };

async function listInbound(to: string, sinceDay: string): Promise<TwilioMsg[]> {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
  const out: TwilioMsg[] = [];
  let url: string | null = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json?${new URLSearchParams({ To: to, 'DateSent>': sinceDay, PageSize: '1000' })}`;
  for (let pages = 0; url && pages < 20; pages++) {
    const res: Response = await fetch(url, { headers: { Authorization: `Basic ${auth}` }, cache: 'no-store' });
    const json = (await res.json().catch(() => ({}))) as ListPage;
    if (!res.ok) throw new Error(json.message || `Twilio error ${res.status}`);
    out.push(...(json.messages ?? []));
    url = json.next_page_uri ? `https://api.twilio.com${json.next_page_uri}` : null;
  }
  return out.filter((m) => m.direction === 'inbound');
}

export type Recovered = { at: string; from: string; name: string | null; body: string };

/**
 * Replies that never reached ShiftReady (e.g. while the webhook was failing) are still stored in Twilio.
 * This fetches every reply since `since`, skips any ShiftReady already has, and handles the rest
 * oldest first, exactly as if they had just arrived. Temps get the normal answer texted back.
 */
export async function recoverMissedReplies(since: Date) {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_FROM_NUMBER) throw new Error('Twilio isn’t set up.');
  const sinceDay = new Date(since.getTime() - 864e5).toISOString().slice(0, 10); // Twilio filters by day: start a day early, then cut exactly
  const tos = [process.env.TWILIO_FROM_NUMBER, process.env.TWILIO_WHATSAPP_FROM ? `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}` : null].filter(Boolean) as string[];
  const all = (await Promise.all(tos.map((to) => listInbound(to, sinceDay)))).flat()
    .map((m) => ({ ...m, when: new Date(m.date_sent ?? m.date_created) }))
    .filter((m) => m.when >= since)
    .sort((a, b) => a.when.getTime() - b.when.getTime());

  const db = createAdminClient();
  const have = new Set<string>();
  for (let i = 0; i < all.length; i += 200) {
    const { data } = await db.from('messages').select('provider_id').in('provider_id', all.slice(i, i + 200).map((m) => m.sid));
    (data ?? []).forEach((r) => r.provider_id && have.add(r.provider_id));
  }
  const missed = all.filter((m) => !have.has(m.sid));

  const done: Recovered[] = [];
  for (const m of missed) {
    await handleInbound({ From: m.from, To: m.to, Body: m.body ?? '', MessageSid: m.sid });
    const { data: t } = await db.from('temps').select('first_name,last_name').eq('mobile', m.from.replace(/^whatsapp:/, '')).maybeSingle();
    done.push({ at: m.when.toISOString(), from: m.from.replace(/^whatsapp:/, ''), name: t ? `${t.first_name} ${t.last_name}` : null, body: (m.body ?? '').slice(0, 160) });
  }
  return { found: all.length, alreadyHad: all.length - missed.length, recovered: done };
}
