'use server';
import { revalidatePath } from 'next/cache';
import { requireStaff, audit } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { APPLY_MESSAGE_KEY, applyMessageProblems } from '@/lib/applyMessage';
import { inviteApplicant } from '@/lib/applications';

type Result = { ok: boolean; error?: string; message?: string };

/** Admins change the text job board applicants get. */
export async function saveApplyMessage(text: string): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  if (profile.role !== 'admin') return { ok: false, error: 'Only an admin can change this message.' };
  const value = text.replace(/\s+/g, ' ').trim();
  const problems = applyMessageProblems(value);
  if (problems.length) return { ok: false, error: problems.join('. ') + '.' };
  const { error } = await supabase.from('app_settings').upsert({ key: APPLY_MESSAGE_KEY, value, updated_at: new Date().toISOString(), updated_by: profile.id });
  if (error) return { ok: false, error: 'Couldn’t save. Try again.' };
  await audit(supabase, profile.id, 'settings.apply_message', 'Changed the text CV-Library applicants get');
  revalidatePath('/registrations');
  return { ok: true, message: 'Saved. New applicants will get this message.' };
}

/** Tries again for an application that wasn't texted (registration was switched off, or the text failed). */
export async function retryApplication(id: string): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const { data: a } = await supabase.from('job_applications').select('*').eq('id', id).maybeSingle();
  if (!a) return { ok: false, error: 'Not found.' };
  if (!['not_sent', 'failed'].includes(a.outcome)) return { ok: false, error: 'This one doesn’t need sending again.' };
  const outcome = await inviteApplicant(createAdminClient(), {
    id: a.id, source: a.source, first: a.first_name ?? '', last: a.last_name ?? '', mobile: a.mobile, phoneRaw: a.phone_raw ?? '', jobTitle: a.job_title ?? '', email: a.email,
  });
  await audit(supabase, profile.id, 'application.retried', `Tried again to text ${a.first_name} ${a.last_name} their registration link`);
  revalidatePath('/registrations');
  return ['texted', 'resent', 'emailed'].includes(outcome) ? { ok: true, message: 'Sent.' } : { ok: false, error: 'Still couldn’t send. See the note on the row.' };
}
