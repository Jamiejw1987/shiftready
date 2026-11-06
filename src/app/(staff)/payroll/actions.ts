'use server';
import { requireStaff, audit } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { encryptionReady } from '@/lib/crypto';
import { matchStarters, startersWorkbook, type StarterResult } from '@/lib/starters';

/** Admins and the people ticked as payroll contacts on the Team page. */
async function payrollStaff() {
  const s = await requireStaff();
  if (s.profile.role !== 'admin' && !s.profile.payroll) return null;
  return s;
}

export async function checkStarters(text: string): Promise<{ ok: boolean; error?: string; result?: StarterResult }> {
  if (!(await payrollStaff())) return { ok: false, error: 'Only admins and payroll contacts can use this.' };
  if (!encryptionReady()) return { ok: false, error: 'Encryption key missing. Check FIELD_ENCRYPTION_KEY in Vercel.' };
  try {
    return { ok: true, result: await matchStarters(createAdminClient(), text.slice(0, 100_000)) };
  } catch {
    return { ok: false, error: 'Couldn’t check the list. Try again.' };
  }
}

/** Re-checks the list on the server and returns the Excel file (base64). Every download is logged with the names in it. */
export async function downloadStarters(text: string): Promise<{ ok: boolean; error?: string; file?: string; count?: number }> {
  const s = await payrollStaff();
  if (!s) return { ok: false, error: 'Only admins and payroll contacts can use this.' };
  try {
    const db = createAdminClient();
    const r = await matchStarters(db, text.slice(0, 100_000));
    if (!r.matched.length) return { ok: false, error: 'Nobody on the list matched, so there’s nothing to download.' };
    const buf = await startersWorkbook(db, r.matched.map((m) => m.id));
    const names = r.matched.map((m) => m.name);
    await audit(s.supabase, s.profile.id, 'payroll.starters_downloaded',
      `Downloaded payroll details (incl. NI and bank) for ${names.length}: ${names.join(', ')}`.slice(0, 4000));
    return { ok: true, file: buf.toString('base64'), count: names.length };
  } catch {
    return { ok: false, error: 'Couldn’t build the file. Check FIELD_ENCRYPTION_KEY in Vercel hasn’t changed, then try again.' };
  }
}
