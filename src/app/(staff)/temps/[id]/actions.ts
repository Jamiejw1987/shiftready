'use server';
import { revalidatePath } from 'next/cache';
import { requireStaff, audit } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/crypto';
import { sendToTemp } from '@/lib/sms';
import { regApprovedText, bankLinkText, myLinkText, regInviteText } from '@/lib/texts';
import { toE164, displayMobile } from '@/lib/phone';
import { geocodePostcode, looksLikePostcode, normalisePostcode } from '@/lib/geo';
import { JOB_TYPES } from '@/lib/format';
import { uploadSlots, recordUploads, DOC_KIND_LABEL, type DocKindFile } from '@/lib/storage';

type Result = { ok: boolean; error?: string; message?: string };
type Field = 'ni' | 'health' | 'convictions' | 'bank';
const LABEL: Record<Field, string> = { ni: 'National Insurance number', health: 'health information', convictions: 'convictions information', bank: 'bank details' };

/** Shows one encrypted field. NI numbers: any staff. Health, convictions and bank: admins only. Every view is logged. */
export async function reveal(tempId: string, field: Field): Promise<Result & { value?: string }> {
  const { supabase, profile } = await requireStaff({ admin: field !== 'ni' });
  const col = { ni: 'ni_enc', health: 'health_enc', convictions: 'convictions_enc', bank: 'bank_enc' }[field];
  const { data: p } = await supabase.from('temp_profiles').select(`${col}, temps(first_name,last_name)`).eq('temp_id', tempId).maybeSingle();
  if (!p) return { ok: false, error: 'Nothing on file.' };
  const row = p as unknown as Record<string, string | null> & { temps: { first_name: string; last_name: string } };
  let value = '';
  try {
    const v = decrypt<string | { declared?: boolean; details?: string; name?: string; sortCode?: string; account?: string }>(row[col]);
    if (v == null) value = 'Not given';
    else if (typeof v === 'string') value = v;
    else if (field === 'bank') value = `${v.name}\nSort code ${v.sortCode!.replace(/(\d{2})(\d{2})(\d{2})/, '$1-$2-$3')}\nAccount ${v.account}`;
    else value = v.declared ? `Yes. ${v.details || '(no details given)'}` : 'No';
  } catch {
    return { ok: false, error: 'Couldn’t decrypt. Check FIELD_ENCRYPTION_KEY in Vercel hasn’t changed.' };
  }
  await audit(supabase, profile.id, 'temp.viewed_sensitive', `Viewed ${row.temps.first_name} ${row.temps.last_name}'s ${LABEL[field]}`);
  return { ok: true, value };
}

export async function staffUploadSlot(tempId: string, kind: string, type: string, size: number) {
  await requireStaff();
  return uploadSlots(createAdminClient(), tempId, [{ kind, type, size }]);
}

export async function recordStaffUpload(tempId: string, kind: string, path: string, filename: string): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const n = await recordUploads(createAdminClient(), tempId, [{ kind, path, filename }], profile.id);
  if (!n) return { ok: false, error: 'The upload didn’t arrive. Try again.' };
  const { data: t } = await supabase.from('temps').select('first_name,last_name').eq('id', tempId).single();
  await audit(supabase, profile.id, 'temp.document_added', `Uploaded ${DOC_KIND_LABEL[kind as DocKindFile] ?? 'a document'} for ${t?.first_name} ${t?.last_name}`);
  revalidatePath(`/temps/${tempId}`);
  return { ok: true };
}

/**
 * Records the right to work check. A share code check needs the GOV.UK result saved as a document;
 * a British or Irish passport needs a copy on file and confirmation the original was seen.
 */
export async function recordRtwCheck(tempId: string, c: { route: 'share_code' | 'british_irish'; expires: string; noLimit: boolean; seenOriginal: boolean }): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const { data: t } = await supabase.from('temps').select('first_name,last_name').eq('id', tempId).single();
  if (!t) return { ok: false, error: 'Not found.' };
  const { data: docs } = await supabase.from('temp_documents').select('kind').eq('temp_id', tempId);
  const kinds = new Set((docs ?? []).map((d) => d.kind));
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  if (c.route === 'share_code') {
    if (!kinds.has('rtw_check')) return { ok: false, error: 'Upload the GOV.UK check result (PDF or screenshot) first.' };
    if (!c.noLimit && !/^\d{4}-\d{2}-\d{2}$/.test(c.expires)) return { ok: false, error: 'Enter the date their permission to work ends, or tick "No time limit".' };
    if (!c.noLimit && c.expires <= today) return { ok: false, error: 'That date has passed. They can’t work until they have a valid right to work.' };
  } else {
    if (!kinds.has('passport') && !kinds.has('id')) return { ok: false, error: 'A copy of the passport must be on file. Upload one first.' };
    if (!c.seenOriginal) return { ok: false, error: 'Confirm you’ve seen the original passport, in person or on a video call.' };
  }
  const expires = c.route === 'share_code' && !c.noLimit ? c.expires : null;
  await supabase.from('temps').update({ rtw_route: c.route, rtw_checked_at: new Date().toISOString(), rtw_checked_by: profile.id, rtw_expires: expires }).eq('id', tempId);
  await audit(supabase, profile.id, 'temp.rtw_checked', `Checked ${t.first_name} ${t.last_name}'s right to work (${c.route === 'share_code' ? 'share code' : 'British/Irish passport'}${expires ? `, expires ${expires}` : ', no time limit'})`);
  revalidatePath(`/temps/${tempId}`);
  return { ok: true, message: 'Right to work check saved.' };
}

export async function approve(tempId: string): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const { data: t } = await supabase.from('temps').select('*').eq('id', tempId).single();
  if (!t || t.status !== 'review') return { ok: false, error: 'Only registrations waiting to be checked can be approved.' };
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  if (!t.rtw_checked_at) return { ok: false, error: 'Record the right to work check first.' };
  if (t.rtw_expires && t.rtw_expires <= today) return { ok: false, error: 'Their right to work has expired.' };
  if (t.needs_admin_review && profile.role !== 'admin') return { ok: false, error: 'This candidate declared something an admin needs to review. Ask an admin to approve.' };
  const { data: p } = await supabase.from('temp_profiles').select('messages_consent').eq('temp_id', tempId).maybeSingle();
  const now = new Date().toISOString();
  const willGetShifts = !!p?.messages_consent;
  await supabase.from('temps').update({
    status: willGetShifts ? 'active' : 'out', approved_at: now, approved_by: profile.id,
    ...(willGetShifts ? { opted_in_at: now } : { opted_out_at: now }),
  }).eq('id', tempId);
  const r = await sendToTemp({ db: supabase, temp: t, kind: 'system', sentBy: profile.id, body: regApprovedText(t.first_name, willGetShifts) });
  await audit(supabase, profile.id, 'temp.approved', `Approved ${t.first_name} ${t.last_name}${willGetShifts ? '' : ' (they didn’t agree to shift messages, so they won’t get offers)'}`);
  revalidatePath(`/temps/${tempId}`);
  revalidatePath('/registrations');
  return { ok: true, message: `${t.first_name} approved${r.ok ? ' and texted' : ''}.` };
}

export async function messageTemp(tempId: string, body: string): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const text = body.trim();
  if (!text) return { ok: false, error: 'Write a message first.' };
  if (text.length > 600) return { ok: false, error: 'Keep it under 600 characters.' };
  const { data: t } = await supabase.from('temps').select('id,first_name,last_name,mobile,status').eq('id', tempId).single();
  if (!t) return { ok: false, error: 'Not found.' };
  if (t.status === 'out') return { ok: false, error: `${t.first_name} has opted out of messages.` };
  const r = await sendToTemp({ db: supabase, temp: t, kind: 'system', sentBy: profile.id, body: text });
  await audit(supabase, profile.id, 'temp.messaged', `Texted ${t.first_name} ${t.last_name}: "${text.slice(0, 60)}${text.length > 60 ? '...' : ''}"`);
  return r.ok ? { ok: true, message: 'Sent.' } : { ok: false, error: `Text failed: ${r.error}` };
}

export async function sendBankLink(tempId: string): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const { data: t } = await supabase.from('temps').select('id,first_name,last_name,mobile,reg_token,registered_at,bank_on_file').eq('id', tempId).single();
  if (!t?.registered_at) return { ok: false, error: 'They need to register first.' };
  if (t.bank_on_file) return { ok: false, error: 'Bank details are already on file.' };
  const r = await sendToTemp({ db: supabase, temp: t, kind: 'system', sentBy: profile.id, body: bankLinkText(t.first_name, t.reg_token) });
  await audit(supabase, profile.id, 'temp.bank_link_sent', `Sent bank details link to ${t.first_name} ${t.last_name}`);
  return r.ok ? { ok: true, message: 'Bank details link sent.' } : { ok: false, error: `Text failed: ${r.error}` };
}

export async function sendMyLink(tempId: string): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const { data: t } = await supabase.from('temps').select('id,first_name,last_name,mobile,reg_token,status').eq('id', tempId).single();
  if (!t) return { ok: false, error: 'Not found.' };
  if (t.status === 'invited' || t.status === 'review') return { ok: false, error: 'They need to finish registering first.' };
  const r = await sendToTemp({ db: supabase, temp: t, kind: 'system', sentBy: profile.id, body: myLinkText(t.first_name, t.reg_token) });
  await audit(supabase, profile.id, 'temp.my_link_sent', `Sent holiday/P45 link to ${t.first_name} ${t.last_name}`);
  return r.ok ? { ok: true, message: 'Link sent.' } : { ok: false, error: `Text failed: ${r.error}` };
}

/** Admins can clear bank details (e.g. a temp has changed bank) so the temp can add new ones from their link. */
export async function clearBank(tempId: string): Promise<Result> {
  const { supabase, profile } = await requireStaff({ admin: true });
  const { data: t } = await supabase.from('temps').select('first_name,last_name').eq('id', tempId).single();
  await supabase.from('temp_profiles').update({ bank_enc: null, bank_last4: null, bank_added_at: null }).eq('temp_id', tempId);
  await supabase.from('temps').update({ bank_on_file: false }).eq('id', tempId);
  await audit(supabase, profile.id, 'temp.bank_cleared', `Cleared ${t?.first_name} ${t?.last_name}'s bank details so they can add new ones`);
  revalidatePath(`/temps/${tempId}`);
  return { ok: true, message: 'Bank details cleared. Send them the bank link to add new ones.' };
}

/** Corrects a temp's name, mobile, postcode or job types. A new mobile gets a short text so they know it's been updated. */
export async function updateDetails(tempId: string, d: { first: string; last: string; mobile: string; postcode: string; jobTypes: string[] }): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const { data: t } = await supabase.from('temps').select('*').eq('id', tempId).single();
  if (!t) return { ok: false, error: 'Not found.' };
  const first = d.first.trim().slice(0, 60), last = d.last.trim().slice(0, 60);
  const mobile = toE164(d.mobile);
  if (!first || !last) return { ok: false, error: 'Add a first name and surname.' };
  if (!mobile) return { ok: false, error: 'Enter a UK mobile starting 07.' };
  const jobTypes = d.jobTypes.filter((x) => (JOB_TYPES as readonly string[]).includes(x));
  const isCandidate = t.status === 'invited';
  if (!jobTypes.length && !isCandidate) return { ok: false, error: 'Tick at least one job type.' };
  const update: Record<string, unknown> = { first_name: first, last_name: last, job_types: jobTypes };
  const changes: string[] = [];
  if (first !== t.first_name || last !== t.last_name) changes.push('name');
  if (JSON.stringify(jobTypes) !== JSON.stringify(t.job_types)) changes.push('job types');

  if (d.postcode.trim() || t.postcode) {
    if (!looksLikePostcode(d.postcode)) return { ok: false, error: 'Enter a full postcode.' };
    const pc = normalisePostcode(d.postcode);
    if (pc !== t.postcode) {
      const point = await geocodePostcode(pc);
      if (!point) return { ok: false, error: `We couldn’t find the postcode ${pc}.` };
      Object.assign(update, { postcode: pc, lat: point.lat, lng: point.lng });
      changes.push('postcode');
    }
  }
  const mobileChanged = mobile !== t.mobile;
  if (mobileChanged) {
    const { data: other } = await supabase.from('temps').select('first_name,last_name').eq('mobile', mobile).neq('id', tempId).maybeSingle();
    if (other) return { ok: false, error: `That mobile already belongs to ${other.first_name} ${other.last_name}.` };
    // WhatsApp has to be re-checked for the new number.
    Object.assign(update, { mobile, wa_status: 'unknown' });
    changes.push(`mobile ${displayMobile(t.mobile)} → ${displayMobile(mobile)}`);
  }
  if (!changes.length) return { ok: false, error: 'Nothing has changed.' };
  const { error } = await supabase.from('temps').update(update).eq('id', tempId);
  if (error) return { ok: false, error: 'Couldn’t save. Try again.' };

  let texted = '';
  if (mobileChanged && t.status !== 'out') {
    const temp = { id: tempId, mobile };
    const body = isCandidate
      ? regInviteText(first, t.reg_token)
      : `Hi ${first}, Staff Selection UK has updated your mobile number to this one. You'll get shift offers here from now on. Reply STOP to opt out. - Staff Selection`;
    const r = await sendToTemp({ db: supabase, temp, kind: isCandidate ? 'registration' : 'system', sentBy: profile.id, body });
    texted = r.ok ? (isCandidate ? ' Registration link sent to the new number.' : ' A text has been sent to the new number.') : ' The text to the new number failed: check it’s right.';
  }
  await audit(supabase, profile.id, 'temp.updated', `Updated ${first} ${last}: ${changes.join(', ')}`);
  revalidatePath(`/temps/${tempId}`);
  revalidatePath('/temps');
  return { ok: true, message: `Saved.${texted}` };
}
