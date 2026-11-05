'use server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendStaffLink } from '@/lib/staffLinks';

/**
 * "Forgotten password" on the sign-in page. Only emails people on the team, at most once a minute each,
 * and always gives the same answer so it can't be used to find out who has an account.
 */
export async function requestPasswordReset(emailIn: string): Promise<{ ok: boolean; error?: string }> {
  const email = emailIn.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Type your work email above first, then press Forgotten password.' };
  const db = createAdminClient();
  const { data: p } = await db.from('profiles').select('id,full_name,email,active').ilike('email', email).maybeSingle();
  if (!p || !p.active) return { ok: true };

  const since = new Date(Date.now() - 60e3).toISOString();
  const { count } = await db.from('audit_log').select('id', { count: 'exact', head: true }).eq('action', 'auth.reset_sent').eq('actor', p.id).gte('created_at', since);
  if (count) return { ok: true };

  const r = await sendStaffLink(db, { email: p.email, full_name: p.full_name }, false);
  await db.from('audit_log').insert({ actor: p.id, action: r.ok ? 'auth.reset_sent' : 'auth.reset_failed', detail: r.ok ? `${p.full_name} asked for a password reset link` : `Password reset email to ${p.full_name} failed: ${r.error}` });
  return r.ok ? { ok: true } : { ok: false, error: 'We couldn’t send the email just now. Try again in a minute, or ask an admin to send you a link.' };
}
