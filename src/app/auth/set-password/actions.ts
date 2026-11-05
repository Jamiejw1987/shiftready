'use server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Saves a new password for whoever just opened an invite or reset link.
 * Done on the server because Supabase won't let someone who already has an authenticator app change their
 * password from a reset link alone (it wants the 6-digit code first, which they can't give before signing in).
 * Only works for a session that came from an emailed link or a full two-step sign-in.
 */
export async function savePassword(pw: string): Promise<{ ok: boolean; error?: string }> {
  if (pw.length < 12) return { ok: false, error: 'Use at least 12 characters.' };
  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'This link has expired. Go to sign in and press Forgotten password for a new one.' };
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const methods = (aal?.currentAuthenticationMethods ?? []).map((m) => (typeof m === 'string' ? m : m.method));
  if (aal?.currentLevel !== 'aal2' && !methods.some((m) => ['recovery', 'invite', 'otp', 'magiclink', 'email/signup'].includes(m))) {
    return { ok: false, error: 'This link has expired. Go to sign in and press Forgotten password for a new one.' };
  }
  const { error } = await createAdminClient().auth.admin.updateUserById(auth.user.id, { password: pw });
  if (error) return { ok: false, error: /weak|pwned|leaked/i.test(error.message) ? 'That password is too easy to guess. Try a longer phrase.' : error.message };
  return { ok: true };
}
