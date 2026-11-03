'use server';
import { revalidatePath } from 'next/cache';
import { requireStaff, audit } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';

/** Each person can mute client-alert emails for themselves. In-app alerts always show. */
export async function setMyEmailAlerts(on: boolean) {
  const { supabase, profile } = await requireStaff();
  await createAdminClient().from('profiles').update({ client_email_alerts: on }).eq('id', profile.id);
  await audit(supabase, profile.id, 'alerts.email', `${profile.full_name} ${on ? 'turned on' : 'muted'} client alert emails`);
  revalidatePath('/notifications');
  return { ok: true };
}
