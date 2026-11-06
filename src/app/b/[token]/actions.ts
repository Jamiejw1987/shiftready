'use server';
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { encrypt, encryptionReady } from '@/lib/crypto';
import { sendToTemp } from '@/lib/sms';
import { bankChangedText } from '@/lib/texts';

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * A registered temp adds their bank details from their private link. Once details are on file they can only be
 * changed in the 48 hours after staff text a change link (so an old, forwarded or stolen link can't redirect
 * someone's pay). A change overwrites the old details and texts the temp to confirm.
 */
export async function saveBank(token: string, b: { name: string; sortCode: string; account: string; account2: string }) {
  if (!UUID.test(token)) return { ok: false, error: 'Link not valid.' };
  if (!encryptionReady()) return { ok: false, error: 'This page is temporarily unavailable. Please call the office.' };
  const db = createAdminClient();
  const { data: t } = await db.from('temps').select('id,first_name,last_name,mobile,status,bank_on_file,bank_change_until').eq('reg_token', token).maybeSingle();
  if (!t) return { ok: false, error: 'Link not valid.' };
  if (t.status === 'invited' || t.status === 'review') return { ok: false, error: 'Please finish registering first.' };
  const changing = !!t.bank_on_file;
  if (changing && !(t.bank_change_until && new Date(t.bank_change_until) > new Date())) return { ok: false, error: 'This link has expired for changing bank details. Please call the office for a new one.' };
  const name = b.name.replace(/\s+/g, ' ').trim().slice(0, 70);
  const sort = b.sortCode.replace(/\D/g, '');
  const acc = b.account.replace(/\D/g, '');
  if (name.length < 2) return { ok: false, error: 'Enter the name on the account.' };
  if (sort.length !== 6) return { ok: false, error: 'Your sort code should be 6 numbers, like 12-34-56.' };
  if (acc.length !== 8) return { ok: false, error: 'Your account number should be 8 numbers. If yours has 7, add a 0 at the start.' };
  if (acc !== b.account2.replace(/\D/g, '')) return { ok: false, error: 'The two account numbers don’t match.' };
  const now = new Date().toISOString();
  let oldLast4: string | null = null;
  if (changing) {
    const { data: p } = await db.from('temp_profiles').select('bank_last4').eq('temp_id', t.id).maybeSingle();
    oldLast4 = p?.bank_last4 ?? null;
  }
  // Temps added before online registration may not have a profile row yet, so create it if needed. New details replace any old ones.
  const { error } = await db.from('temp_profiles').upsert({ temp_id: t.id, bank_enc: encrypt({ name, sortCode: sort, account: acc }), bank_last4: acc.slice(-4), bank_added_at: now, updated_at: now }, { onConflict: 'temp_id' });
  if (error) return { ok: false, error: 'Couldn’t save your details. Please try again.' };
  await db.from('temps').update(changing ? { bank_on_file: true, bank_change_until: null } : { bank_on_file: true }).eq('id', t.id);
  await db.from('audit_log').insert(changing
    ? { actor: null, action: 'temp.bank_changed', detail: `${t.first_name} ${t.last_name} changed bank details (account ending ${oldLast4 ?? '????'} → ${acc.slice(-4)})` }
    : { actor: null, action: 'temp.bank_added', detail: `${t.first_name} ${t.last_name} added bank details (account ending ${acc.slice(-4)})` });
  if (changing) await sendToTemp({ db, temp: t, kind: 'system', body: bankChangedText(t.first_name, acc.slice(-4)) }).catch(() => null);
  revalidatePath(`/b/${token}`);
  return { ok: true };
}
