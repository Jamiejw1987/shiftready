'use server';
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { encrypt, encryptionReady } from '@/lib/crypto';

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * A registered temp adds their bank details from their private link. Once details are on file they can't be
 * changed from the link (so a forwarded or stolen link can't redirect someone's pay): changes go through the office.
 */
export async function saveBank(token: string, b: { name: string; sortCode: string; account: string; account2: string }) {
  if (!UUID.test(token)) return { ok: false, error: 'Link not valid.' };
  if (!encryptionReady()) return { ok: false, error: 'This page is temporarily unavailable. Please call the office.' };
  const db = createAdminClient();
  const { data: t } = await db.from('temps').select('id,first_name,last_name,registered_at,bank_on_file').eq('reg_token', token).maybeSingle();
  if (!t?.registered_at) return { ok: false, error: 'Please finish registering first.' };
  if (t.bank_on_file) return { ok: false, error: 'We already have your bank details. To change them, please call the office.' };
  const name = b.name.replace(/\s+/g, ' ').trim().slice(0, 70);
  const sort = b.sortCode.replace(/\D/g, '');
  const acc = b.account.replace(/\D/g, '');
  if (name.length < 2) return { ok: false, error: 'Enter the name on the account.' };
  if (sort.length !== 6) return { ok: false, error: 'Your sort code should be 6 numbers, like 12-34-56.' };
  if (acc.length !== 8) return { ok: false, error: 'Your account number should be 8 numbers. If yours has 7, add a 0 at the start.' };
  if (acc !== b.account2.replace(/\D/g, '')) return { ok: false, error: 'The two account numbers don’t match.' };
  const now = new Date().toISOString();
  await db.from('temp_profiles').update({ bank_enc: encrypt({ name, sortCode: sort, account: acc }), bank_last4: acc.slice(-4), bank_added_at: now, updated_at: now }).eq('temp_id', t.id);
  await db.from('temps').update({ bank_on_file: true }).eq('id', t.id);
  await db.from('audit_log').insert({ actor: null, action: 'temp.bank_added', detail: `${t.first_name} ${t.last_name} added bank details (account ending ${acc.slice(-4)})` });
  revalidatePath(`/b/${token}`);
  return { ok: true };
}
