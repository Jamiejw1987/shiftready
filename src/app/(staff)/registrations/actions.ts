'use server';
import { revalidatePath } from 'next/cache';
import { requireStaff, audit } from '@/lib/auth';
import { toE164, displayMobile } from '@/lib/phone';
import { sendToTemp } from '@/lib/sms';
import { regInviteText } from '@/lib/texts';
import { currentDocs, docProblems } from '@/lib/docs';
import { encryptionReady } from '@/lib/crypto';

type Result = { ok: boolean; error?: string; message?: string };

async function readyToRegister(supabase: Awaited<ReturnType<typeof requireStaff>>['supabase']): Promise<string | null> {
  if (!encryptionReady()) return 'Registration is switched off: the encryption key (FIELD_ENCRYPTION_KEY) hasn’t been added in Vercel yet.';
  const problems = docProblems(await currentDocs(supabase));
  return problems.length ? `Registration is switched off until the documents are ready: ${problems.join('; ')}. An admin can fix this on Team > Documents.` : null;
}

/** Creates an invited candidate and texts them their personal registration link. */
export async function sendRegistrationLink(input: { first: string; last: string; mobile: string }): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const blocked = await readyToRegister(supabase);
  if (blocked) return { ok: false, error: blocked };
  const first = input.first.trim().slice(0, 60), last = input.last.trim().slice(0, 60);
  const mobile = toE164(input.mobile);
  if (!first || !last) return { ok: false, error: 'Add their first name and surname.' };
  if (!mobile) return { ok: false, error: 'Enter a UK mobile starting 07.' };
  const { data: existing } = await supabase.from('temps').select('id,first_name,last_name').eq('mobile', mobile).maybeSingle();
  if (existing) return { ok: false, error: `${existing.first_name} ${existing.last_name} already has this mobile. Open their record to send them the registration form.` };
  const { data: t, error } = await supabase
    .from('temps')
    .insert({ first_name: first, last_name: last, mobile, status: 'invited', job_types: [], added_by: profile.id, reg_requested_at: new Date().toISOString() })
    .select('id,mobile,reg_token')
    .single();
  if (error || !t) return { ok: false, error: 'Couldn’t save. Try again.' };
  const r = await sendToTemp({ db: supabase, temp: t, kind: 'registration', sentBy: profile.id, body: regInviteText(first, t.reg_token) });
  await audit(supabase, profile.id, 'temp.invited', `Sent registration link to ${first} ${last} (${displayMobile(mobile)})${r.ok ? '' : ' - text failed'}`);
  revalidatePath('/registrations');
  return r.ok ? { ok: true, message: `Registration link sent to ${first}.` } : { ok: true, message: `${first} added, but the text failed (${r.error}). Use Resend.` };
}

/** Texts the registration link again, or for the first time to a temp who was added before registration existed. */
export async function resendRegistration(id: string): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const blocked = await readyToRegister(supabase);
  if (blocked) return { ok: false, error: blocked };
  const { data: t } = await supabase.from('temps').select('id,first_name,last_name,mobile,reg_token,registered_at,status').eq('id', id).single();
  if (!t) return { ok: false, error: 'Not found.' };
  if (t.registered_at) return { ok: false, error: `${t.first_name} has already registered.` };
  if (t.status === 'out') return { ok: false, error: `${t.first_name} has opted out of messages.` };
  await supabase.from('temps').update({ reg_requested_at: new Date().toISOString() }).eq('id', id);
  const r = await sendToTemp({ db: supabase, temp: t, kind: 'registration', sentBy: profile.id, body: regInviteText(t.first_name, t.reg_token) });
  await audit(supabase, profile.id, 'temp.invite_resent', `Sent registration link to ${t.first_name} ${t.last_name}`);
  revalidatePath('/registrations');
  revalidatePath(`/temps/${id}`);
  return r.ok ? { ok: true, message: 'Registration link sent.' } : { ok: false, error: `Text failed: ${r.error}` };
}
