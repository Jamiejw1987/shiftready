import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendSms } from './sms';
import { shiftWhen } from './format';
import { findClash } from './clash';

export type OfferAction = 'accept' | 'decline' | 'standby' | 'alerts' | 'reset';
const REASONS = ['Not available', 'Too far', 'Pay rate', 'Other'];

/**
 * Records a temp's answer to an offer, whichever way it came in (link, text reply or WhatsApp button).
 * Uses the database function that locks the shift, so two people can never take the last place.
 * Must be called with the service-role client.
 */
export async function respondToOffer(db: SupabaseClient, token: string, action: OfferAction, reason?: string | null) {
  const r = REASONS.includes(reason ?? '') ? reason : null;
  const { data: o } = await db.from('offers').select('temp_id,status,decline_reason,shifts(id,shift_date,start_time,end_time)').eq('token', token).maybeSingle();
  // Someone the office took off a shift can't put themselves back on it.
  if (o?.status === 'declined' && o.decline_reason === 'Removed by office' && action !== 'decline') return 'removed';
  if (action === 'accept') {
    // Nobody can be booked on two shifts that overlap.
    const s = o?.shifts as unknown as { id: string; shift_date: string; start_time: string; end_time: string } | null;
    if (o && s && o.status !== 'accepted' && (await findClash(db, o.temp_id, s))) return 'clash';
  }
  const { data, error } = await db.rpc('respond_to_offer', { p_token: token, p_action: action, p_reason: action === 'decline' ? r : null });
  if (error) return 'error';
  const result = data as string;
  if (action === 'accept' && result === 'accepted') await notifyConsultant(db, token);
  return result;
}

/** Texts the consultant who sent the shift, if they've added a mobile on the Team page. */
async function notifyConsultant(db: SupabaseClient, token: string) {
  const { data: o } = await db
    .from('offers')
    .select('shift_id,temps(first_name,last_name),shifts(client,shift_date,start_time,end_time,heads,sent_by)')
    .eq('token', token)
    .single();
  if (!o) return;
  const s = o.shifts as unknown as { client: string; shift_date: string; start_time: string; end_time: string; heads: number; sent_by: string | null };
  const t = o.temps as unknown as { first_name: string; last_name: string };
  if (!s.sent_by) return;
  const { data: p } = await db.from('profiles').select('mobile').eq('id', s.sent_by).maybeSingle();
  if (!p?.mobile) return;
  const { count } = await db.from('offers').select('id', { count: 'exact', head: true }).eq('shift_id', o.shift_id).eq('status', 'accepted');
  await sendSms({ db, to: p.mobile, kind: 'system', body: `ShiftReady: ${t.first_name} ${t.last_name} accepted ${s.client}, ${shiftWhen(s)} (${count}/${s.heads} filled).` });
}
