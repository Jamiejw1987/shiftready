import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendSms, sendToTemp } from '@/lib/sms';
import { respondToOffer, type OfferAction } from '@/lib/offerFlow';
import { validTwilioRequest } from '@/lib/twilioSignature';
import { shiftWhen } from '@/lib/format';
import {
  appUrl, OPTED_IN_REPLY, OPTED_OUT_REPLY, replyAccepted, replyDeclined, replyFull, replyStandby, REPLY_HELP, REPLY_NO_OFFER, REPLY_ON_HOLD, REPLY_ATTENDED, replyClash,
} from '@/lib/texts';

/**
 * Twilio calls this when a temp replies by text or WhatsApp (set as the "A message comes in" webhook
 * on the phone number and on the WhatsApp sender).
 *   YES / START / "Yes, send me shifts" button -> opt in (if not yet opted in), otherwise accept the latest offer
 *   Accept / Decline buttons                     -> answer the exact offer the buttons were on
 *   NO -> decline the latest offer · STANDBY -> standby on the latest offer · STOP -> opt out
 */

const STOP = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'OPTOUT', 'OPT OUT', 'NO THANKS'];
const YES = ['YES', 'Y', 'YEP', 'YEAH', 'YES PLEASE', 'OK', 'ACCEPT', 'ACCEPTED'];
const START = ['START', 'UNSTOP', 'OPTIN', 'OPT IN', 'YES SEND ME SHIFTS'];
const ATTENDED = ['ATTENDED', 'I ATTENDED', 'I WAS THERE', 'WAS THERE', 'I DID ATTEND', 'I WENT', 'I DID GO'];
const NO = ['NO', 'N', 'NOPE', 'DECLINE', 'CANT', 'CANNOT', 'NO THANK YOU'];

const twiml = () => new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', { headers: { 'Content-Type': 'text/xml' } });

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => (params[k] = String(v)));
  if (!validTwilioRequest(req, params)) return new NextResponse('Forbidden', { status: 403 });

  const rawFrom = params.From || '';
  const channel = rawFrom.startsWith('whatsapp:') ? 'whatsapp' : 'sms';
  const from = rawFrom.replace(/^whatsapp:/, '');
  const body = (params.Body || '').trim();
  const payload = (params.ButtonPayload || '').toUpperCase();
  const word = (payload || body).toUpperCase().replace(/[^A-Z ]/g, '').replace(/\s+/g, ' ').trim();

  const db = createAdminClient();
  const { data: t } = await db.from('temps').select('id,first_name,last_name,mobile,status,registered_at,bank_on_file,reg_token').eq('mobile', from).maybeSingle();
  await db.from('messages').insert({
    temp_id: t?.id ?? null, from_number: from, direction: 'in', channel, kind: 'reply', body: (body || params.ButtonText || '').slice(0, 1000),
    status: 'received', provider_id: params.MessageSid ?? null,
  });
  if (!t) return twiml();
  if (channel === 'whatsapp') await db.from('temps').update({ wa_status: 'yes' }).eq('id', t.id);

  const reply = (text: string) => sendToTemp({ db, temp: t, body: text, kind: 'reply' });
  const name = `${t.first_name} ${t.last_name}`;

  // Opting out always wins.
  if (STOP.includes(word) || payload === 'OPTOUT') {
    if (t.status !== 'out') {
      await db.from('temps').update({ status: 'out', opted_out_at: new Date().toISOString() }).eq('id', t.id);
      await db.from('audit_log').insert({ actor: null, action: 'temp.opted_out', detail: `${name} opted out by ${channel === 'whatsapp' ? 'WhatsApp' : 'text'}` });
      await reply(OPTED_OUT_REPLY);
    }
    return twiml();
  }

  // Opting in: the welcome button, START, or YES from someone not yet opted in.
  if (payload === 'OPTIN' || START.includes(word) || (YES.includes(word) && (t.status === 'pending' || t.status === 'out'))) {
    if (t.status === 'pending' || t.status === 'out') {
      await db.from('temps').update({ status: 'active', opted_in_at: new Date().toISOString(), opted_out_at: null }).eq('id', t.id);
      await db.from('audit_log').insert({ actor: null, action: 'temp.opted_in', detail: `${name} opted in by ${channel === 'whatsapp' ? 'WhatsApp' : 'text'}` });
      await reply(OPTED_IN_REPLY);
    }
    return twiml();
  }

  // Asking for their own page (holiday, P45, 48-hour choice, bank details).
  if (['HOLIDAY', 'HOLIDAYS', 'P', 'ACCOUNT', 'MY ACCOUNT', 'LINK'].includes(word) || /^P ?45$/.test(body.trim().toUpperCase())) {
    if (t.status === 'invited' || t.status === 'review') await reply('Please finish registering first, then you can request holiday or your P45. - Staff Selection');
    else if (word === 'P') await reply(`Hi ${t.first_name}, confirm your last day and request your P45 here: ${appUrl()}/me/${t.reg_token}?do=p45 - Staff Selection`);
    else if (word.startsWith('HOLIDAY')) await reply(`Hi ${t.first_name}, choose the dates you'd like off here: ${appUrl()}/me/${t.reg_token}?do=holiday - Staff Selection`);
    else await reply(`Hi ${t.first_name}, request holiday or your P45 here: ${appUrl()}/me/${t.reg_token} - Staff Selection`);
    return twiml();
  }

  // Answering the "still coming?" check-in sent before a shift.
  const firstWord = word.split(' ')[0];
  const ciYes = YES.includes(word) || YES.includes(firstWord) || /^(ON MY WAY|OMW|COMING|SEE YOU)/.test(word);
  const ciNo = !ciYes && (NO.includes(word) || NO.includes(firstWord) || /^(CANT|CANNOT|NOT COMING|SICK|ILL)/.test(word));
  if (ciYes || ciNo) {
    const since = new Date(Date.now() - 4 * 3600e3).toISOString();
    const { data: ci } = await db.from('offers').select('id,shifts(client,start_time,sent_by)').eq('temp_id', t.id).eq('status', 'accepted')
      .gte('checkin_sent_at', since).is('checkin_reply', null).order('checkin_sent_at', { ascending: false }).limit(1);
    const c = ci?.[0];
    if (c) {
      const s = c.shifts as unknown as { client: string; start_time: string; sent_by: string | null };
      const yes = ciYes;
      await db.from('offers').update({ checkin_reply: yes ? 'yes' : 'no', checkin_replied_at: new Date().toISOString() }).eq('id', c.id);
      if (yes) {
        await reply(`Thanks ${t.first_name}, see you at ${s.start_time.slice(0, 5)}. - Staff Selection`);
      } else {
        await reply(`Thanks for letting us know, ${t.first_name}. We'll arrange cover. Please call the office if you can. - Staff Selection`);
        await db.from('audit_log').insert({ actor: null, action: 'checkin.cant_make_it', detail: `${name} replied that they can't make ${s.client} at ${s.start_time.slice(0, 5)}` });
        if (s.sent_by) {
          const { data: p } = await db.from('profiles').select('mobile').eq('id', s.sent_by).maybeSingle();
          if (p?.mobile) await sendSms({ db, to: p.mobile, kind: 'system', body: `ShiftReady URGENT: ${name} can't make ${s.client} at ${s.start_time.slice(0, 5)}. Open the shift to take them off and fill the place.` });
        }
      }
      return twiml();
    }
  }

  // Disputing a no-show: tell the consultant who sent the shift.
  if (ATTENDED.includes(word)) {
    const since = new Date(Date.now() - 14 * 864e5).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
    const { data: ns } = await db.from('offers').select('id,shifts!inner(client,shift_date,start_time,end_time,sent_by)').eq('temp_id', t.id).eq('status', 'noshow')
      .gte('shifts.shift_date', since).order('created_at', { ascending: false }).limit(1);
    const n = ns?.[0];
    if (!n) { await reply(REPLY_HELP); return twiml(); }
    const s = n.shifts as unknown as { client: string; shift_date: string; start_time: string; end_time: string; sent_by: string | null };
    const what = `${name} says they attended ${s.client}, ${shiftWhen(s)} but was marked no-show`;
    await db.from('audit_log').insert({ actor: null, action: 'temp.noshow_disputed', detail: what });
    if (s.sent_by) {
      const { data: p } = await db.from('profiles').select('mobile').eq('id', s.sent_by).maybeSingle();
      if (p?.mobile) await sendSms({ db, to: p.mobile, kind: 'system', body: `ShiftReady: ${what}. Please check with the client.` });
    }
    await reply(REPLY_ATTENDED);
    return twiml();
  }

  // Answering a shift offer.
  let action: OfferAction | null = null;
  if (payload === 'ACCEPT' || YES.includes(word)) action = 'accept';
  else if (payload === 'DECLINE' || NO.includes(word)) action = 'decline';
  else if (word === 'STANDBY' || payload === 'STANDBY') action = 'standby';
  if (!action) {
    if (/^(HELP|INFO|\?)$/.test(word)) await reply(REPLY_HELP);
    return twiml(); // Anything else is left for a consultant to read in the message log.
  }
  if (t.status === 'hold') { await reply(REPLY_ON_HOLD); return twiml(); }

  // Which offer? A WhatsApp button knows the exact message it was on; a typed reply means the latest open offer.
  let offerId: string | null = null;
  if (params.OriginalRepliedMessageSid) {
    const { data: m } = await db.from('messages').select('offer_id').eq('provider_id', params.OriginalRepliedMessageSid).maybeSingle();
    offerId = m?.offer_id ?? null;
  }
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  let q = db.from('offers').select('id,token,status,shifts!inner(client,site,site_postcode,shift_date,start_time,end_time,status)').eq('temp_id', t.id);
  q = offerId ? q.eq('id', offerId) : q.gte('shifts.shift_date', today).neq('shifts.status', 'cancelled')
    .in('status', ['sent', 'standby', 'declined', 'alerts', 'accepted']);
  const { data: offers } = await q.order('created_at', { ascending: false }).limit(1);
  const o = offers?.[0];
  if (!o) { await reply(REPLY_NO_OFFER); return twiml(); }
  const s = o.shifts as unknown as { client: string; site: string; site_postcode: string; shift_date: string; start_time: string; end_time: string };
  const when = shiftWhen(s);

  const result = await respondToOffer(db, o.token, action, null);
  if (result === 'accepted' && action !== 'accept') await reply(`You're booked on ${s.client} ${when}. To cancel, please call the office. - Staff Selection`);
  else if (result === 'accepted') await reply(replyAccepted(s.client, when, `${s.site}, ${s.site_postcode}`, t.registered_at && !t.bank_on_file ? t.reg_token : null));
  else if (result === 'full') await reply(replyFull(s.client, when));
  else if (result === 'clash') await reply(replyClash(s.client, when));
  else if (result === 'removed') await reply(`You were taken off ${s.client} ${when}. Please call the office if you have any questions. - Staff Selection`);
  else if (result === 'declined') await reply(replyDeclined(s.client, when));
  else if (result === 'standby') await reply(replyStandby(s.client, when));
  else if (result === 'not_active') await reply(REPLY_ON_HOLD);
  else await reply(REPLY_NO_OFFER);
  return twiml();
}
