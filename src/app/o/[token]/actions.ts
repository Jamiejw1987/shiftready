'use server';
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendSms } from '@/lib/sms';
import { OPTED_IN_REPLY } from '@/lib/texts';

const UUID = /^[0-9a-f-]{36}$/i;

export async function optIn(token: string) {
  if (!UUID.test(token)) return;
  const db = createAdminClient();
  const { data: t } = await db.from('temps').select('id,first_name,last_name,mobile,status').eq('optin_token', token).maybeSingle();
  if (!t || t.status === 'active' || t.status === 'hold') return;
  await db.from('temps').update({ status: 'active', opted_in_at: new Date().toISOString(), opted_out_at: null }).eq('id', t.id);
  await db.from('audit_log').insert({ actor: null, action: 'temp.opted_in', detail: `${t.first_name} ${t.last_name} opted in to shift texts (via link)` });
  await sendSms({ db, to: t.mobile, body: OPTED_IN_REPLY, kind: 'system', tempId: t.id });
  revalidatePath(`/o/${token}`);
}

export async function optOut(token: string) {
  if (!UUID.test(token)) return;
  const db = createAdminClient();
  const { data: t } = await db.from('temps').select('id,first_name,last_name,status').eq('optin_token', token).maybeSingle();
  if (!t || t.status === 'out') return;
  await db.from('temps').update({ status: 'out', opted_out_at: new Date().toISOString() }).eq('id', t.id);
  await db.from('audit_log').insert({ actor: null, action: 'temp.opted_out', detail: `${t.first_name} ${t.last_name} opted out of shift texts (via link)` });
  revalidatePath(`/o/${token}`);
}
