import 'server-only';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export type Profile = {
  id: string;
  full_name: string;
  email: string;
  role: 'admin' | 'consultant';
  mobile: string | null;
  active: boolean;
  notif_seen_at?: string | null;
  client_email_alerts?: boolean;
  client_sms_alerts?: boolean;
  payroll?: boolean;              // ticked as a payroll contact on the Team page
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
  if (aal?.currentLevel !== 'aal2') {
    // Client users sign in by email link and never set up two-step sign-in: send them to their portal.
    const { data: cu } = await createAdminClient().from('client_users').select('id').eq('auth_user_id', auth.user.id).maybeSingle();
    if (cu) redirect('/portal');
    redirect('/login?step=2fa');
  }

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', auth.user.id).maybeSingle();
  if (!profile || !profile.active) redirect('/login?error=access');
  if (opts.admin && profile.role !== 'admin') redirect('/temps');

  return { supabase, profile: profile as Profile };
}

export async function audit(supabase: ReturnType<typeof createClient>, actor: string, action: string, detail: string) {
  await supabase.from('audit_log').insert({ actor, action, detail });
}
