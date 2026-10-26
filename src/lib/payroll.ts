import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendSms } from './sms';

/** Texts everyone ticked as a payroll contact on the Team page (or the admins, if nobody is ticked yet). */
export async function alertPayroll(db: SupabaseClient, body: string) {
  const { data: people } = await db.from('profiles').select('mobile,payroll,role').eq('active', true).not('mobile', 'is', null);
  const payroll = (people ?? []).filter((p) => p.payroll);
  const to = payroll.length ? payroll : (people ?? []).filter((p) => p.role === 'admin');
  for (const p of to) await sendSms({ db, to: p.mobile!, kind: 'system', body });
}
