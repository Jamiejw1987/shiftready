import 'server-only';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export type ClientUser = {
  id: string; client_id: string; auth_user_id: string; email: string; full_name: string | null; mobile: string | null;
  job_title: string | null; all_sites: boolean; status: 'invited' | 'active' | 'removed'; joined_at: string | null; last_login_at: string | null;
};
export type Site = { id: string; name: string; address: string; postcode: string };

/**
 * Use at the top of every client portal page and action. Signed in by email link, an invited or active user,
 * at a client that's switched on. Returns the user, their company and the sites they look after.
 * `supabase` acts as the client user, so the database's own rules apply to anything read with it.
 */
export async function requireClient(opts: { allowIncomplete?: boolean } = {}) {
  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/portal/login');

  const db = createAdminClient();
  const { data: cu } = await db.from('client_users')
    .select('id,client_id,auth_user_id,email,full_name,mobile,job_title,all_sites,status,joined_at,last_login_at,clients(id,name,active,cutoff_hours,is_test)')
    .eq('auth_user_id', auth.user.id).maybeSingle();
  const client = cu?.clients as unknown as { id: string; name: string; active: boolean; cutoff_hours: number; is_test: boolean; logo: string | null } | null;
  if (!cu || cu.status === 'removed' || !client?.active) {
    // Office staff who wander in here go back to their own screens.
    const { data: staff } = await db.from('profiles').select('id').eq('id', auth.user.id).maybeSingle();
    if (staff) redirect('/temps');
    redirect('/portal/login?error=access');
  }

  // The logo is read on its own so the portal still works if it can't be loaded.
  const { data: brand } = await db.from('clients').select('logo').eq('id', client.id).maybeSingle();
  client.logo = (brand as { logo?: string | null } | null)?.logo ?? null;

  // First sign-in turns an invite into an active user. Last sign-in is recorded at most every 10 minutes.
  const now = new Date();
  if (cu.status === 'invited' || !cu.last_login_at || now.getTime() - Date.parse(cu.last_login_at) > 10 * 60e3) {
    await db.from('client_users').update({
      last_login_at: now.toISOString(),
      ...(cu.status === 'invited' ? { status: 'active', joined_at: now.toISOString() } : {}),
    }).eq('id', cu.id);
  }

  const { data: allSites } = await db.from('client_sites').select('id,name,address,postcode').eq('client_id', client.id).eq('active', true).order('name');
  let sites = (allSites ?? []) as Site[];
  if (!cu.all_sites) {
    const { data: mine } = await db.from('client_user_sites').select('site_id').eq('client_user_id', cu.id);
    const ok = new Set((mine ?? []).map((m) => m.site_id));
    sites = sites.filter((s) => ok.has(s.id));
  }
  const user = { ...cu, status: cu.status === 'invited' ? 'active' : cu.status } as unknown as ClientUser;
  if (!opts.allowIncomplete && (!user.full_name || !user.mobile || !user.job_title)) redirect('/portal/welcome');
  return { supabase, db, user, client, sites };
}

export const userName = (u: { full_name: string | null; email: string }) => u.full_name || u.email;
