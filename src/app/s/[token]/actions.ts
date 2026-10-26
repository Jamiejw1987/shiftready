'use server';
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendSms } from '@/lib/sms';
import { shiftWhen } from '@/lib/format';

const UUID = /^[0-9a-f-]{36}$/i;
const REASONS = ['Not available', 'Too far', 'Pay rate', 'Other'];

export async function respond(token: string, action: 'accept' | 'decline' | 'standby' | 'alerts' | 'reset', opts: { ppeTicked?: number; reason?: string } = {}) {
  if (!UUID.test(token)) return { result: 'not_found' };
  const db = createAdminClient();

  if (action === 'accept') {
    const { data: o } = await db.from('offers').select('shifts(ppe)').eq('token', token).maybeSingle();
    const ppe = (o?.shifts as unknown as { ppe: string[] } | null)?.ppe ?? [];
    if ((opts.ppeTicked ?? 0) < ppe.length) return { result: 'ppe' };
  }
  const reason = action === 'decline' && opts.reason && REASONS.includes(opts.reason) ? opts.reason : null;
  const { data: result, error } = await db.rpc('respond_to_offer', { p_token: token, p_action: action, p_reason: reason });
  if (error) return { result: 'error' };

  // Let the consultant who sent the shift know, if they've added a mobile to their profile.
  if (action === 'accept' && result === 'accepted') {
    const { data: o } = await db
      .from('offers')
      .select('shift_id,temps(first_name,last_name),shifts(client,shift_date,start_time,end_time,heads,sent_by)')
      .eq('token', token)
      .single();
    if (o) {
      const s = o.shifts as unknown as { client: string; shift_date: string; start_time: string; end_time: string; heads: number; sent_by: string | null };
      const t = o.temps as unknown as { first_name: string; last_name: string };
      const { count } = await db.from('offers').select('id', { count: 'exact', head: true }).eq('shift_id', o.shift_id).eq('status', 'accepted');
      if (s.sent_by) {
        const { data: p } = await db.from('profiles').select('mobile').eq('id', s.sent_by).maybeSingle();
        if (p?.mobile)
          await sendSms({ db, to: p.mobile, kind: 'system', body: `ShiftReady: ${t.first_name} ${t.last_name} accepted ${s.client}, ${shiftWhen(s)} (${count}/${s.heads} filled).` });
      }
    }
  }
  revalidatePath(`/s/${token}`);
  return { result: result as string };
}
