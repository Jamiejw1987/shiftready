'use server';
import { revalidatePath } from 'next/cache';
import { requireStaff, audit } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { toE164 } from '@/lib/phone';
import { sendStaffLink } from '@/lib/staffLinks';

type Result = { ok: boolean; error?: string; message?: string };

export async function inviteConsultant(input: { name: string; email: string; role: 'admin' | 'consultant'; mobile: string }): Promise<Result> {
  const { supabase, profile } = await requireStaff({ admin: true });
  const name = input.name.trim(), email = input.email.trim().toLowerCase();
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Add a name and a valid work email.' };
  const mobile = input.mobile.trim() ? toE164(input.mobile) : null;
  if (input.mobile.trim() && !mobile) return { ok: false, error: 'Mobile should be a UK mobile starting 07, or leave it blank.' };

  const admin = createAdminClient();
  const { data: taken } = await admin.from('profiles').select('id').ilike('email', email).maybeSingle();
  if (taken) return { ok: false, error: 'That email is already on the team. Use “Send password link” on their card instead.' };
  const r = await sendStaffLink(admin, { email, full_name: name }, true);
  if (!r.ok) return { ok: false, error: `Invite failed: ${r.error}` };
  const { error: pErr } = await admin.from('profiles').insert({ id: r.userId, full_name: name, email, role: input.role === 'admin' ? 'admin' : 'consultant', mobile });
  if (pErr) return { ok: false, error: 'The invite was sent but the profile couldn’t be saved. Contact your developer.' };
  await audit(supabase, profile.id, 'team.invited', `Invited ${name} (${email}) as ${input.role}`);
  revalidatePath('/team');
  return { ok: true, message: r.dryRun ? 'Email isn’t set up (no Postmark token), so nothing was sent.' : `Invite emailed to ${email}.` };
}

/** Emails someone a fresh link to set their password: for a lost invite or a forgotten password. */
export async function sendLoginLink(id: string): Promise<Result> {
  const { supabase, profile } = await requireStaff({ admin: true });
  const admin = createAdminClient();
  const { data: p } = await admin.from('profiles').select('full_name,email,active').eq('id', id).single();
  if (!p) return { ok: false, error: 'Not found.' };
  if (!p.active) return { ok: false, error: `Restore ${p.full_name}’s access first.` };
  const r = await sendStaffLink(admin, { email: p.email, full_name: p.full_name }, false);
  if (!r.ok) return { ok: false, error: `Couldn’t send: ${r.error}` };
  await audit(supabase, profile.id, 'team.link_sent', `Sent ${p.full_name} a link to set their password`);
  return { ok: true, message: r.dryRun ? 'Email isn’t set up (no Postmark token), so nothing was sent.' : `Password link emailed to ${p.email}. It works once and lasts 24 hours.` };
}

export async function setAccess(id: string, active: boolean): Promise<Result> {
  const { supabase, profile } = await requireStaff({ admin: true });
  if (id === profile.id) return { ok: false, error: 'You can’t switch off your own access.' };
  const admin = createAdminClient();
  const { data: p } = await admin.from('profiles').select('full_name').eq('id', id).single();
  await admin.from('profiles').update({ active }).eq('id', id);
  // Also blocks sign-in at the auth level and ends their sessions when switched off.
  await admin.auth.admin.updateUserById(id, { ban_duration: active ? 'none' : '876000h' });
  await audit(supabase, profile.id, active ? 'team.restored' : 'team.switched_off', `${active ? 'Restored' : 'Switched off'} access for ${p?.full_name}`);
  revalidatePath('/team');
  return { ok: true };
}

export async function setPayroll(id: string, on: boolean): Promise<Result> {
  const { supabase, profile } = await requireStaff({ admin: true });
  const admin = createAdminClient();
  const { data: p } = await admin.from('profiles').select('full_name,mobile').eq('id', id).single();
  await admin.from('profiles').update({ payroll: on }).eq('id', id);
  await audit(supabase, profile.id, 'team.payroll', `${on ? 'Made' : 'Removed'} ${p?.full_name} ${on ? 'a payroll contact' : 'as a payroll contact'}`);
  revalidatePath('/team');
  return { ok: true, message: on && !p?.mobile ? `${p?.full_name} is now a payroll contact. Add their mobile so they get request alerts.` : undefined };
}

export async function updateMember(id: string, input: { role: 'admin' | 'consultant'; mobile: string }): Promise<Result> {
  const { supabase, profile } = await requireStaff({ admin: true });
  if (id === profile.id && input.role !== 'admin') return { ok: false, error: 'You can’t remove your own admin role.' };
  const mobile = input.mobile.trim() ? toE164(input.mobile) : null;
  if (input.mobile.trim() && !mobile) return { ok: false, error: 'Mobile should be a UK mobile starting 07.' };
  const admin = createAdminClient();
  const { data: p } = await admin.from('profiles').select('full_name').eq('id', id).single();
  await admin.from('profiles').update({ role: input.role, mobile }).eq('id', id);
  await audit(supabase, profile.id, 'team.updated', `Updated ${p?.full_name}: role ${input.role}${mobile ? ', mobile set' : ''}`);
  revalidatePath('/team');
  return { ok: true };
}

/** Whether this person gets a text for every new, changed or cancelled client request (admins decide). */
export async function setClientSms(id: string, on: boolean): Promise<Result> {
  const { supabase, profile } = await requireStaff({ admin: true });
  const admin = createAdminClient();
  const { data: p } = await admin.from('profiles').select('full_name,mobile').eq('id', id).single();
  await admin.from('profiles').update({ client_sms_alerts: on }).eq('id', id);
  await audit(supabase, profile.id, 'team.client_sms', `${on ? 'Switched on' : 'Switched off'} client request texts for ${p?.full_name}`);
  revalidatePath('/team');
  return { ok: true, message: on && !p?.mobile ? `Switched on. Add ${p?.full_name}'s mobile so the texts reach them.` : undefined };
}

/** Re-runs replies Twilio received but ShiftReady never got (e.g. while the webhook was failing). Admins only. */
export async function recoverReplies(sinceIso: string): Promise<Result & { found?: number; alreadyHad?: number; recovered?: { at: string; from: string; name: string | null; body: string }[] }> {
  const { supabase, profile } = await requireStaff({ admin: true });
  const since = new Date(sinceIso);
  if (Number.isNaN(since.getTime())) return { ok: false, error: 'Pick a date and time.' };
  if (Date.now() - since.getTime() > 14 * 864e5) return { ok: false, error: 'You can go back up to 14 days.' };
  try {
    const { recoverMissedReplies } = await import('@/lib/recover');
    const r = await recoverMissedReplies(since);
    await audit(supabase, profile.id, 'replies.recovered', `Recovered ${r.recovered.length} missed replies since ${since.toISOString().slice(0, 16).replace('T', ' ')} UTC`);
    revalidatePath('/shifts');
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Something went wrong.' };
  }
}
