'use server';
import { revalidatePath } from 'next/cache';
import { requireStaff, audit } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { decrypt, encrypt, encryptionReady } from '@/lib/crypto';
import { sendToTemp } from '@/lib/sms';
import { regApprovedText, bankLinkText, bankChangeLinkText, myLinkText, regInviteText, licenceCodeText } from '@/lib/texts';
import { toE164, displayMobile } from '@/lib/phone';
import { geocodePostcode, looksLikePostcode, normalisePostcode } from '@/lib/geo';
import { JOB_TYPES } from '@/lib/format';
import { uploadSlots, recordUploads, DOC_KIND_LABEL, type DocKindFile } from '@/lib/storage';

type Result = { ok: boolean; error?: string; message?: string };
type Field = 'ni' | 'health' | 'convictions' | 'bank';
const LABEL: Record<Field, string> = { ni: 'National Insurance number', health: 'health information', convictions: 'convictions information', bank: 'bank details' };

/** Shows one encrypted field. NI, health and convictions: any staff (consultants check these before approving). Bank: admins only. Every view is logged. */
export async function reveal(tempId: string, field: Field): Promise<Result & { value?: string }> {
  const { supabase, profile } = await requireStaff({ admin: field === 'bank' });
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
  const { data: t } = await supabase.from('temps').select('id,first_name,last_name,mobile,reg_token,status,bank_on_file').eq('id', tempId).single();
  if (!t) return { ok: false, error: 'Not found.' };
  if (t.status === 'invited' || t.status === 'review') return { ok: false, error: 'They need to finish registering first.' };
  if (t.bank_on_file) return { ok: false, error: 'Bank details are already on file.' };
  const r = await sendToTemp({ db: supabase, temp: t, kind: 'system', sentBy: profile.id, body: bankLinkText(t.first_name, t.reg_token) });
  await audit(supabase, profile.id, 'temp.bank_link_sent', `Sent bank details link to ${t.first_name} ${t.last_name}`);
  return r.ok ? { ok: true, message: 'Bank details link sent.' } : { ok: false, error: `Text failed: ${r.error}` };
}

/**
 * Texts a temp a link to replace the bank details already on file. The link only accepts a change for 48 hours
 * after it's sent, so an old or forwarded link can't be used to redirect someone's pay later. If nothing is on
 * file yet it just sends the normal bank details link.
 */
export async function sendBankChangeLink(tempId: string): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const { data: t } = await supabase.from('temps').select('id,first_name,last_name,mobile,reg_token,status,bank_on_file').eq('id', tempId).single();
  if (!t) return { ok: false, error: 'Not found.' };
  if (!t.bank_on_file) return sendBankLink(tempId);
  const until = new Date(Date.now() + 48 * 3600e3).toISOString();
  const { error } = await supabase.from('temps').update({ bank_change_until: until }).eq('id', t.id);
  if (error) return { ok: false, error: /bank_change_until/.test(error.message) ? 'One-off setup needed: run supabase/2026-11-06-bank-change.sql in Supabase first.' : 'Couldn’t set up the link. Try again.' };
  const r = await sendToTemp({ db: supabase, temp: t, kind: 'system', sentBy: profile.id, body: bankChangeLinkText(t.first_name, t.reg_token) });
  await audit(supabase, profile.id, 'temp.bank_change_link_sent', `Sent change bank details link to ${t.first_name} ${t.last_name}`);
  revalidatePath(`/temps/${tempId}`);
  return r.ok ? { ok: true, message: 'Change link sent. It works for 48 hours; their new details will replace the old ones.' } : { ok: false, error: `Text failed: ${r.error}` };
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

/**
 * Everything payroll needs for one temp, as plain text ready to paste: name, DOB, NI, address, contact, bank.
 * Admins only (it includes bank details and NI). Logged in the audit trail.
 */
export async function payrollDetails(tempId: string): Promise<Result & { text?: string }> {
  const { supabase, profile } = await requireStaff({ admin: true });
  const { data: t } = await supabase.from('temps').select('first_name,last_name,mobile,postcode').eq('id', tempId).single();
  if (!t) return { ok: false, error: 'Temp not found.' };
  const { data: p } = await supabase.from('temp_profiles').select('dob,email,address1,address2,town,ni_enc,bank_enc').eq('temp_id', tempId).maybeSingle();
  let ni: string | null = null;
  let bank: { name: string; sortCode: string; account: string } | null = null;
  try {
    ni = decrypt<string>(p?.ni_enc);
    bank = decrypt<{ name: string; sortCode: string; account: string }>(p?.bank_enc);
  } catch {
    return { ok: false, error: 'Couldn’t decrypt. Check FIELD_ENCRYPTION_KEY in Vercel hasn’t changed.' };
  }
  const dob = p?.dob ? new Date(p.dob + 'T12:00:00Z').toLocaleDateString('en-GB') : '';
  const lines = [
    `Name: ${t.first_name} ${t.last_name}`,
    dob && `Date of birth: ${dob}`,
    ni && `NI number: ${ni}`,
    `Address: ${[p?.address1, p?.address2, p?.town, t.postcode].filter(Boolean).join(', ')}`,
    `Mobile: ${displayMobile(t.mobile)}`,
    p?.email && `Email: ${p.email}`,
    bank ? `Name on account: ${bank.name}` : 'Bank: not added yet',
    bank && `Sort code: ${bank.sortCode.replace(/(\d{2})(\d{2})(\d{2})/, '$1-$2-$3')}`,
    bank && `Account number: ${bank.account}`,
  ].filter(Boolean);
  await audit(supabase, profile.id, 'temp.viewed_sensitive', `Copied ${t.first_name} ${t.last_name}'s payroll details (incl. NI and bank details)`);
  return { ok: true, text: lines.join('\n') };
}

export type RegEdit = {
  dob: string; email: string; nationality: string; address1: string; address2: string; town: string;
  ni: string; nokName: string; nokRelationship: string; nokPhone: string;
};

/**
 * Fixes mistakes in what a temp typed when they registered (wrong date of birth, typo in address...).
 * Any consultant can do this. NI is only changed if a new one is typed. Every change is logged, with the old
 * and new date of birth so there's a record.
 */
export async function updateRegistration(tempId: string, d: RegEdit): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const { data: t } = await supabase.from('temps').select('first_name,last_name,registered_at').eq('id', tempId).single();
  if (!t) return { ok: false, error: 'Not found.' };
  const { data: p } = await supabase.from('temp_profiles').select('dob,email,nationality,address1,address2,town,nok_name,nok_relationship,nok_phone').eq('temp_id', tempId).maybeSingle();
  if (!p) return { ok: false, error: 'They haven’t registered yet, so there’s nothing to edit.' };
  const clean = (v: string, max: number) => v.replace(/\s+/g, ' ').trim().slice(0, max);

  const problems: string[] = [];
  const dob = d.dob.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) problems.push('a date of birth');
  else {
    const b = new Date(dob + 'T12:00:00Z'), n = new Date();
    const age = n.getUTCFullYear() - b.getUTCFullYear() - (n < new Date(Date.UTC(n.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate())) ? 1 : 0);
    if (Number.isNaN(age) || age < 16 || age > 90) problems.push('a date of birth that makes them 16 to 90');
  }
  const email = clean(d.email, 120).toLowerCase();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) problems.push('a valid email (or leave it blank)');
  if (clean(d.address1, 120).length < 3) problems.push('the first line of their address');
  if (clean(d.town, 60).length < 2) problems.push('their town');
  if (clean(d.nationality, 60).length < 3) problems.push('their nationality');
  const ni = d.ni.replace(/\s+/g, '').toUpperCase();
  if (ni && !/^[A-Z]{2}\d{6}[A-D]$/.test(ni)) problems.push('a NI number like QQ123456C (or leave it blank to keep the one on file)');
  if (!clean(d.nokName, 80) || !/^[+\d\s()-]{7,20}$/.test(d.nokPhone.trim())) problems.push('an emergency contact name and phone number');
  if (problems.length) return { ok: false, error: 'Please add ' + problems.join(', ') + '.' };
  if (ni && !encryptionReady()) return { ok: false, error: 'Can’t save the NI number right now (encryption key missing).' };

  const next = {
    dob, email: email || null, nationality: clean(d.nationality, 60), address1: clean(d.address1, 120), address2: clean(d.address2, 120) || null,
    town: clean(d.town, 60), nok_name: clean(d.nokName, 80), nok_relationship: clean(d.nokRelationship, 40) || null, nok_phone: clean(d.nokPhone, 20),
  };
  const labels: Record<string, string> = { email: 'email', nationality: 'nationality', address1: 'address', address2: 'address', town: 'address', nok_name: 'emergency contact', nok_relationship: 'emergency contact', nok_phone: 'emergency contact' };
  const changes = new Set<string>();
  const fmt = (x: string | null) => (x ? new Date(x + 'T12:00:00Z').toLocaleDateString('en-GB') : 'none');
  if (next.dob !== p.dob) changes.add(`date of birth ${fmt(p.dob)} → ${fmt(next.dob)}`);
  for (const k of Object.keys(labels)) if ((next as Record<string, unknown>)[k] !== ((p as Record<string, unknown>)[k] ?? null)) changes.add(labels[k]);
  if (ni) changes.add('NI number');
  if (!changes.size) return { ok: false, error: 'Nothing has changed.' };

  const { error } = await supabase.from('temp_profiles').update({ ...next, ...(ni ? { ni_enc: encrypt(ni) } : {}), updated_at: new Date().toISOString() }).eq('temp_id', tempId);
  if (error) return { ok: false, error: 'Couldn’t save. Try again.' };
  await audit(supabase, profile.id, 'temp.registration_edited', `Corrected ${t.first_name} ${t.last_name}'s registration: ${[...changes].join(', ')}`);
  revalidatePath(`/temps/${tempId}`);
  return { ok: true, message: 'Registration details updated.' };
}

/** Records that the office has checked a driver's licence with the DVLA, with what they found. */
export async function recordLicenceCheck(tempId: string, notes: string): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const { data: t } = await supabase.from('temps').select('first_name,last_name').eq('id', tempId).single();
  if (!t) return { ok: false, error: 'Not found.' };
  const n = notes.replace(/\s+/g, ' ').trim().slice(0, 500);
  if (n.length < 2) return { ok: false, error: 'Add a short note of what the check showed, e.g. “Valid, C+E, 3 points (SP30)”.' };
  const { error } = await supabase.from('temp_profiles').update({ licence_checked_at: new Date().toISOString(), licence_checked_by: profile.id, licence_check_notes: n }).eq('temp_id', tempId);
  if (error) return { ok: false, error: 'Couldn’t save. Has supabase/2026-11-05-driving.sql been run?' };
  await audit(supabase, profile.id, 'temp.licence_checked', `Checked ${t.first_name} ${t.last_name}'s driving licence with the DVLA: ${n}`);
  revalidatePath(`/temps/${tempId}`);
  return { ok: true, message: 'Licence check recorded.' };
}

/** Texts a driver asking for a new DVLA check code, with a link to add it. */
export async function requestCheckCode(tempId: string): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const { data: t } = await supabase.from('temps').select('id,first_name,last_name,mobile,reg_token,status').eq('id', tempId).single();
  if (!t) return { ok: false, error: 'Not found.' };
  if (t.status === 'out') return { ok: false, error: 'They’ve opted out of texts.' };
  const r = await sendToTemp({ db: supabase, temp: t, kind: 'system', sentBy: profile.id, body: licenceCodeText(t.first_name, t.reg_token) });
  await audit(supabase, profile.id, 'temp.licence_code_requested', `Asked ${t.first_name} ${t.last_name} for a new DVLA check code`);
  return r.ok ? { ok: true, message: 'Text sent asking for a new check code.' } : { ok: false, error: `Text failed: ${r.error}` };
}

/**
 * Sets or clears a temp's weekly hours limit (e.g. a student visa allows 20 hours a week in term time).
 * While set, ShiftReady won't offer or book them on anything that takes them over it in a Mon-Sun week.
 */
export async function setHoursCap(tempId: string, on: boolean, hours: number, reason: string): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const { data: t } = await supabase.from('temps').select('first_name,last_name,hours_cap').eq('id', tempId).maybeSingle();
  if (!t) return { ok: false, error: 'Not found.' };
  const cap = on ? Math.round(hours) : null;
  if (on && !(cap! >= 1 && cap! <= 60)) return { ok: false, error: 'Enter the weekly hours limit (1 to 60).' };
  const why = on ? reason.trim().slice(0, 200) || null : null;
  const { error } = await supabase.from('temps').update({ hours_cap: cap, hours_cap_reason: why }).eq('id', tempId);
  if (error) return { ok: false, error: 'Couldn’t save. Has supabase/2026-11-13-hours-limit.sql been run in Supabase?' };
  await audit(supabase, profile.id, 'temp.hours_cap', on
    ? `Set ${t.first_name} ${t.last_name}'s weekly hours limit to ${cap}${why ? ` (${why})` : ''}${t.hours_cap ? `, was ${t.hours_cap}` : ''}`
    : `Removed ${t.first_name} ${t.last_name}'s weekly hours limit${t.hours_cap ? ` (was ${t.hours_cap})` : ''}`);
  revalidatePath(`/temps/${tempId}`);
  return { ok: true, message: on ? `Limit saved: ${t.first_name} can’t be booked over ${cap} hours a week.` : 'Limit removed.' };
}
