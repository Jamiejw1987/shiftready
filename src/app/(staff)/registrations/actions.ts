'use server';
import { revalidatePath } from 'next/cache';
import { requireStaff, audit } from '@/lib/auth';
import { toE164, displayMobile } from '@/lib/phone';
import { sendToTemp, sendMany } from '@/lib/sms';
import { regInviteText, regWithInductionText, appUrl } from '@/lib/texts';
import { createInduction } from '@/lib/inductionOps';
import { applyMessageProblems, renderApplyMessage } from '@/lib/applyMessage';
import { currentDocs, docProblems } from '@/lib/docs';
import { encryptionReady } from '@/lib/crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { removeTempFiles } from '@/lib/storage';

type Result = { ok: boolean; error?: string; message?: string };

/** A custom invite message must still carry the link, the sender and the opt-out. Null = use the standard text. */
function checkMessage(message?: string | null): { template: string | null; error?: string } {
  const t = (message ?? '').trim();
  if (!t) return { template: null };
  const problems = applyMessageProblems(t);
  return problems.length ? { template: null, error: `Fix the message first: ${problems.join('; ')}.` } : { template: t };
}
const inviteBody = (template: string | null, first: string, token: string, job?: string | null) =>
  template ? renderApplyMessage(template, { first, job, token }) : regInviteText(first, token);

async function readyToRegister(supabase: Awaited<ReturnType<typeof requireStaff>>['supabase']): Promise<string | null> {
  if (!encryptionReady()) return 'Registration is switched off: the encryption key (FIELD_ENCRYPTION_KEY) hasn’t been added in Vercel yet.';
  const problems = docProblems(await currentDocs(supabase));
  return problems.length ? `Registration is switched off until the documents are ready: ${problems.join('; ')}. An admin can fix this on Team > Documents.` : null;
}

/** Creates an invited candidate and texts them their personal registration link. */
/**
 * Removes someone from Ready to check: registered but not filled in properly and can't be reached.
 * Only for people still waiting to be checked (never approved, never worked). Deletes their record, ID and
 * documents, and blanks their messages. They aren't texted. They can register again later if they come back.
 */
export async function removeRegistration(id: string): Promise<Result> {
  const { profile } = await requireStaff();
  const db = createAdminClient();
  const { data: t } = await db.from('temps').select('id,first_name,last_name,status').eq('id', id).maybeSingle();
  if (!t) return { ok: false, error: 'Already removed. Refresh the page.' };
  if (t.status !== 'review') return { ok: false, error: `${t.first_name} isn’t waiting to be checked any more, so they can’t be removed from here.` };
  const { count } = await db.from('offers').select('id', { count: 'exact', head: true }).eq('temp_id', id);
  if (count) return { ok: false, error: `${t.first_name} has shift history, so they can’t be removed from here. Ask an admin.` };
  await db.from('messages').update({ to_number: null, from_number: null, body: '[removed: registration removed]', fallback_body: null }).eq('temp_id', id);
  const files = await removeTempFiles(db, id);
  const { error } = await db.from('temps').delete().eq('id', id).eq('status', 'review');
  if (error) return { ok: false, error: 'Couldn’t remove them. Try again.' };
  await audit(db, profile.id, 'registration.removed', `Removed ${t.first_name} ${t.last_name}'s registration (not completed properly, couldn't be reached) and their personal data${files ? ` (${files} document${files === 1 ? '' : 's'})` : ''}`);
  revalidatePath('/registrations');
  return { ok: true, message: `${t.first_name} ${t.last_name} removed.` };
}

/**
 * Removes someone from Links sent, not finished: they never completed registration and have never been
 * offered a shift. Used when their name or number changed, or to add them manually (e.g. from Kisrec) instead.
 * Deletes the record and any part-filled details, and blanks their messages. They aren't texted.
 * Their mobile is free straight away, so they can be added again.
 */
export async function removeInvite(id: string): Promise<Result> {
  const { profile } = await requireStaff();
  const db = createAdminClient();
  const { data: t } = await db.from('temps').select('id,first_name,last_name,registered_at').eq('id', id).maybeSingle();
  if (!t) return { ok: false, error: 'Already removed. Refresh the page.' };
  if (t.registered_at) return { ok: false, error: `${t.first_name} has finished registering, so they can’t be removed from here.` };
  const { count } = await db.from('offers').select('id', { count: 'exact', head: true }).eq('temp_id', id);
  if (count) return { ok: false, error: `${t.first_name} has shift history, so they can’t be removed from here. Ask an admin.` };
  await db.from('messages').update({ to_number: null, from_number: null, body: '[removed: sign-up link removed]', fallback_body: null }).eq('temp_id', id);
  await removeTempFiles(db, id);
  const { error } = await db.from('temps').delete().eq('id', id).is('registered_at', null);
  if (error) return { ok: false, error: 'Couldn’t remove them. Try again.' };
  await audit(db, profile.id, 'registration.invite_removed', `Removed ${t.first_name} ${t.last_name} from links sent, not finished (unfinished sign-up)`);
  revalidatePath('/registrations');
  return { ok: true, message: `${t.first_name} ${t.last_name} removed.` };
}

export async function sendRegistrationLink(input: { first: string; last: string; mobile: string; message?: string; job?: string; packId?: string }): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const m = checkMessage(input.message);
  if (m.error) return { ok: false, error: m.error };
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
  // A client induction sent with the registration link (one text with both links).
  let body = inviteBody(m.template, first, t.reg_token, input.job);
  let withInd = '';
  if (input.packId) {
    const c = await createInduction(supabase, { tempId: t.id, packId: input.packId, details: { site: '', scope: '', startDate: '', arrival: '' }, sentBy: profile.id });
    if (c.ok) {
      body = m.template ? `${body} Then complete the ${c.packName}: ${appUrl()}/i/${c.induction.token}` : regWithInductionText(first, t.reg_token, c.packName, c.induction.token);
      withInd = ` with the ${c.packName}`;
    } else withInd = ` (induction not added: ${c.error})`;
  }
  const r = await sendToTemp({ db: supabase, temp: t, kind: 'registration', sentBy: profile.id, body });
  await audit(supabase, profile.id, 'temp.invited', `Sent registration link${withInd} to ${first} ${last} (${displayMobile(mobile)})${r.ok ? '' : ' - text failed'}`);
  revalidatePath('/registrations');
  return r.ok ? { ok: true, message: `Registration link sent to ${first}${withInd}.` } : { ok: true, message: `${first} added, but the text failed (${r.error}). Use Resend.` };
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
  // Include a client induction that's waiting for them, so both links go in one text.
  const { data: ind } = await supabase.from('temp_inductions').select('token,induction_packs(name)').eq('temp_id', id).is('cancelled_at', null).is('signed_at', null).order('sent_at', { ascending: false }).limit(1).maybeSingle();
  const packName = (ind?.induction_packs as unknown as { name: string } | null)?.name;
  const body = ind && packName ? regWithInductionText(t.first_name, t.reg_token, packName, ind.token) : regInviteText(t.first_name, t.reg_token);
  const r = await sendToTemp({ db: supabase, temp: t, kind: 'registration', sentBy: profile.id, body });
  await audit(supabase, profile.id, 'temp.invite_resent', `Sent registration link to ${t.first_name} ${t.last_name}`);
  revalidatePath('/registrations');
  revalidatePath(`/temps/${id}`);
  return r.ok ? { ok: true, message: 'Registration link sent.' } : { ok: false, error: `Text failed: ${r.error}` };
}

/**
 * Sends registration links to many people at once: only for people who applied to your roles or asked about
 * work with you (UK PECR soft opt-in). Every text says how to opt out; anyone already on file is skipped.
 */
export async function bulkInvite(rows: { first: string; last: string; mobile: string; job?: string }[], confirmedApplicants: boolean, message?: string, job?: string): Promise<Result & { sent?: number; skipped?: number }> {
  const { supabase, profile } = await requireStaff();
  const m = checkMessage(message);
  if (m.error) return { ok: false, error: m.error };
  if (!confirmedApplicants) return { ok: false, error: 'Tick to confirm these people applied to your roles or asked about work with you.' };
  const blocked = await readyToRegister(supabase);
  if (blocked) return { ok: false, error: blocked };
  if (rows.length > 500) return { ok: false, error: 'Send up to 500 at a time.' };
  const seen = new Set<string>();
  const clean = rows.flatMap((r) => {
    const mobile = toE164(r.mobile), first = (r.first || '').trim().slice(0, 60), last = (r.last || '').trim().slice(0, 60);
    if (!mobile || !first || seen.has(mobile)) return [];
    seen.add(mobile);
    return [{ first, last, mobile, job: (r.job || '').trim().slice(0, 80) }];
  });
  if (!clean.length) return { ok: false, error: 'No valid names and UK mobiles found.' };
  const { data: existing } = await supabase.from('temps').select('mobile').in('mobile', clean.map((c) => c.mobile));
  const known = new Set((existing ?? []).map((e) => e.mobile));
  const fresh = clean.filter((c) => !known.has(c.mobile));
  if (!fresh.length) return { ok: false, error: 'Everyone in the list is already on ShiftReady.' };
  const now = new Date().toISOString();
  const { data: made, error } = await supabase
    .from('temps')
    .insert(fresh.map((c) => ({ first_name: c.first, last_name: c.last || '-', mobile: c.mobile, status: 'invited', job_types: [], added_by: profile.id, reg_requested_at: now })))
    .select('id,first_name,mobile,reg_token');
  if (error || !made) return { ok: false, error: 'Couldn’t save. Nothing was sent. Try again.' };
  const jobFor = new Map(fresh.map((c) => [c.mobile, c.job || job || '']));
  const res = await sendMany(made, (t) => sendToTemp({ db: supabase, temp: t, kind: 'registration', sentBy: profile.id, body: inviteBody(m.template, t.first_name, t.reg_token, jobFor.get(t.mobile)) }));
  const skipped = rows.length - fresh.length;
  await audit(supabase, profile.id, 'temp.bulk_invited', `Sent ${m.template ? 'a custom invite message' : 'registration links'} to ${res.sent} applicants${res.failed ? ` (${res.failed} failed)` : ''}${skipped ? `, ${skipped} skipped` : ''}. Confirmed they applied or asked about work.`);
  revalidatePath('/registrations');
  return { ok: true, sent: res.sent, skipped, message: `Registration links sent to ${res.sent}${res.failed ? `, ${res.failed} failed` : ''}${skipped ? `. ${skipped} skipped (already on ShiftReady, duplicate or not a valid mobile)` : ''}.` };
}
