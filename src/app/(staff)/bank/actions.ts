'use server';
import { requireStaff, audit } from '@/lib/auth';
import { decrypt } from '@/lib/crypto';

export type BankDetails = { name: string; sortCode: string; account: string };

/**
 * Decrypts bank details for the temps asked for. Admins only, and every view is written to the audit trail
 * with the names of whose details were seen.
 */
export async function revealBank(ids: string[], purpose: 'view' | 'download'): Promise<{ ok: boolean; error?: string; details?: Record<string, BankDetails> }> {
  const { supabase, profile } = await requireStaff({ admin: true });
  const list = [...new Set(ids)].filter((i) => /^[0-9a-f-]{36}$/i.test(i)).slice(0, 3000);
  if (!list.length) return { ok: false, error: 'Nobody selected.' };
  const out: Record<string, BankDetails> = {};
  const names: string[] = [];
  for (let i = 0; i < list.length; i += 200) {
    const { data, error } = await supabase.from('temp_profiles').select('temp_id,bank_enc,temps(first_name,last_name)').in('temp_id', list.slice(i, i + 200)).not('bank_enc', 'is', null);
    if (error) return { ok: false, error: 'Couldn’t load bank details. Try again.' };
    for (const row of (data ?? []) as unknown as { temp_id: string; bank_enc: string; temps: { first_name: string; last_name: string } | null }[]) {
      try {
        const v = decrypt<BankDetails>(row.bank_enc);
        if (!v) continue;
        out[row.temp_id] = { name: v.name, sortCode: v.sortCode.replace(/(\d{2})(\d{2})(\d{2})/, '$1-$2-$3'), account: v.account };
        if (row.temps) names.push(`${row.temps.first_name} ${row.temps.last_name}`);
      } catch {
        return { ok: false, error: 'Couldn’t decrypt. Check FIELD_ENCRYPTION_KEY in Vercel hasn’t changed.' };
      }
    }
  }
  const who = names.length <= 5 ? names.join(', ') : `${names.slice(0, 5).join(', ')} and ${names.length - 5} more`;
  await audit(supabase, profile.id, purpose === 'download' ? 'bank.downloaded' : 'temp.viewed_sensitive',
    purpose === 'download' ? `Downloaded bank details for ${names.length} temps (${who})` : `Viewed bank details: ${who}`);
  return { ok: true, details: out };
}
