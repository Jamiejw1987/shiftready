import 'server-only';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export type Profile = {
  id: string;
  full_name: string;
  email: string;
  role: 'admin' | 'consultant';
  mobile: string | null;
  active: boolean;
};

/**
 * Use at the top of every staff page and server action.
 * Signed in + passed two-factor + active profile, or it redirects to sign-in.
 */
export async function requireStaff(opts: { admin?: boolean } = {}) {
  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/login');

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== 'aal2') redirect('/login?step=2fa');

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', auth.user.id).maybeSingle();
  if (!profile || !profile.active) redirect('/login?error=access');
  if (opts.admin && profile.role !== 'admin') redirect('/temps');

  return { supabase, profile: profile as Profile };
}

export async function audit(supabase: ReturnType<typeof createClient>, actor: string, action: string, detail: string) {
  await supabase.from('audit_log').insert({ actor, action, detail });
}
