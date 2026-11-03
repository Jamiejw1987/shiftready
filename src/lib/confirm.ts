import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendSms } from './sms';
import { shiftWhen } from './format';
import { seriesWhen } from './series';
import { afterBookingChange } from './clients';

type S = { id: string; client: string; shift_date: string; start_time: string; end_time: string; status: string; heads: number; sent_by: string | null };

/** Bookings a consultant made that this temp hasn't confirmed yet (upcoming shifts only). */
export async function awaitingFor(db: SupabaseClient, tempId: string, offerIds?: string[]) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  let q = db.from('offers').select('id,shift_id,shifts!inner(id,client,shift_date,start_time,end_time,status,heads,sent_by)')
    .eq('temp_id', tempId).eq('status', 'accepted').eq('awaiting_confirm', true)
    .gte('shifts.shift_date', today).neq('shifts.status', 'cancelled');
  if (offerIds) q = q.in('id', offerIds);
  const { data } = await q;
  return (data ?? []).map((o) => ({ id: o.id, shift: o.shifts as unknown as S }))
    .sort((a, b) => a.shift.shift_date.localeCompare(b.shift.shift_date));
}

/**
 * The temp confirms (yes) or turns down (no) bookings a consultant made for them.
 * Turning down frees the place and texts the consultant who sent the shift.
 */
export async function answerBooking(db: SupabaseClient, temp: { id: string; first_name: string; last_name: string }, items: Awaited<ReturnType<typeof awaitingFor>>, yes: boolean) {
  if (!items.length) return '';
  const now = new Date().toISOString();
  const what = items.length === 1 ? `${items[0].shift.client} ${shiftWhen(items[0].shift)}` : `${items[0].shift.client}, ${seriesWhen(items.map((i) => i.shift))}`;
  if (yes) {
    await db.from('offers').update({ awaiting_confirm: false, responded_at: now }).in('id', items.map((i) => i.id));
    await db.from('audit_log').insert({ actor: null, action: 'offer.confirmed', detail: `${temp.first_name} ${temp.last_name} confirmed ${what}` });
    // Client-requested shifts: the client only sees them, and hears it's full, once they've confirmed.
    for (const id of new Set(items.map((i) => i.shift.id))) await afterBookingChange(db, id);
    return what;
  }
  await db.from('offers').update({ status: 'declined', decline_reason: 'Turned down booking', awaiting_confirm: false, responded_at: now }).in('id', items.map((i) => i.id));
  for (const i of items) if (i.shift.status === 'filled') await db.from('shifts').update({ status: 'open' }).eq('id', i.shift.id);
  await db.from('audit_log').insert({ actor: null, action: 'offer.turned_down', detail: `${temp.first_name} ${temp.last_name} can't do ${what}. Place reopened` });
  const sentBy = items[0].shift.sent_by;
  if (sentBy) {
    const { data: c } = await db.from('profiles').select('mobile').eq('id', sentBy).maybeSingle();
    if (c?.mobile) await sendSms({ db, to: c.mobile, kind: 'system', body: `ShiftReady: ${temp.first_name} ${temp.last_name} can't do ${what}, so the place has reopened.` });
  }
  return what;
}
