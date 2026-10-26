'use server';
import { revalidatePath } from 'next/cache';
import { requireStaff, audit } from '@/lib/auth';
import { toE164, displayMobile } from '@/lib/phone';
import { geocodePostcodes, geocodePostcode, looksLikePostcode, normalisePostcode } from '@/lib/geo';
import { sendSms, sendMany } from '@/lib/sms';
import { welcomeText } from '@/lib/texts';
import { JOB_TYPES } from '@/lib/format';

export type NewTemp = { first: string; last: string; mobile: string; postcode: string; types: string[] };
type Result = { ok: boolean; error?: string; message?: string };

const cleanTypes = (types: string[]) => types.filter((t) => (JOB_TYPES as readonly string[]).includes(t));

export async function addTemp(input: NewTemp, confirmedCompliant: boolean): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const first = input.first.trim(), last = input.last.trim();
  const mobile = toE164(input.mobile);
  const problems: string[] = [];
  if (!first || !last) problems.push('add a first name and surname');
  if (!mobile) problems.push('enter a UK mobile starting 07');
  if (!looksLikePostcode(input.postcode)) problems.push('enter a full postcode');
  if (!cleanTypes(input.types).length) problems.push('tick at least one job type');
  if (!confirmedCompliant) problems.push('confirm they’re compliant in KISREC');
  if (problems.length) return { ok: false, error: 'To add this temp, ' + problems.join(', ') + '.' };

  const postcode = normalisePostcode(input.postcode);
  const point = await geocodePostcode(postcode);
  if (!point) return { ok: false, error: `We couldn’t find the postcode ${postcode}. Check it and try again.` };

  const { data, error } = await supabase
    .from('temps')
    .insert({ first_name: first, last_name: last, mobile, postcode, lat: point.lat, lng: point.lng, job_types: cleanTypes(input.types), added_by: profile.id })
    .select()
    .single();
  if (error) return { ok: false, error: error.code === '23505' ? 'That mobile number is already on the list.' : 'Couldn’t save this temp. Try again.' };

  const sms = await sendSms({ db: supabase, to: data.mobile, body: welcomeText(data.first_name, data.optin_token), kind: 'welcome', tempId: data.id, sentBy: profile.id });
  await audit(supabase, profile.id, 'temp.added', `Added ${first} ${last}. Welcome text ${sms.ok ? 'sent' : 'failed'} to ${displayMobile(data.mobile)}`);
  revalidatePath('/temps');
  return sms.ok
    ? { ok: true, message: `${first} ${last} added. Welcome text sent.` }
    : { ok: true, message: `${first} ${last} added, but the welcome text failed (${sms.error}). Use Resend welcome.` };
}

export type ImportRow = NewTemp;

export async function importTemps(rows: ImportRow[]): Promise<Result & { added?: number; skipped?: { row: number; reason: string }[] }> {
  const { supabase, profile } = await requireStaff();
  if (rows.length > 2000) return { ok: false, error: 'That file has more than 2,000 rows. Split it into smaller files.' };

  const { data: existing } = await supabase.from('temps').select('mobile');
  const known = new Set((existing ?? []).map((t) => t.mobile));
  const skipped: { row: number; reason: string }[] = [];
  const valid: (NewTemp & { e164: string; pc: string; i: number })[] = [];

  rows.forEach((r, i) => {
    const e164 = toE164(r.mobile);
    if (!r.first?.trim()) return skipped.push({ row: i + 2, reason: 'No name' });
    if (!e164) return skipped.push({ row: i + 2, reason: 'Mobile not valid' });
    if (known.has(e164)) return skipped.push({ row: i + 2, reason: 'Already on list' });
    if (!looksLikePostcode(r.postcode)) return skipped.push({ row: i + 2, reason: 'Postcode missing or invalid' });
    known.add(e164);
    valid.push({ ...r, e164, pc: normalisePostcode(r.postcode), i });
  });

  const points = await geocodePostcodes(valid.map((v) => v.pc));
  const toInsert = valid
    .filter((v) => {
      if (points.has(v.pc)) return true;
      skipped.push({ row: v.i + 2, reason: `Postcode ${v.pc} not found` });
      return false;
    })
    .map((v) => ({
      first_name: v.first.trim(),
      last_name: (v.last || '').trim(),
      mobile: v.e164,
      postcode: v.pc,
      lat: points.get(v.pc)!.lat,
      lng: points.get(v.pc)!.lng,
      job_types: cleanTypes(v.types).length ? cleanTypes(v.types) : ['Warehouse'],
      added_by: profile.id,
    }));

  if (!toInsert.length) return { ok: false, error: 'No rows could be added.', skipped };
  const { data, error } = await supabase.from('temps').insert(toInsert).select();
  if (error || !data) return { ok: false, error: 'Couldn’t save the import. Nothing was added. Try again.' };

  const res = await sendMany(
    data.map((t) => ({ db: supabase, to: t.mobile, body: welcomeText(t.first_name, t.optin_token), kind: 'welcome', tempId: t.id, sentBy: profile.id })),
  );
  await audit(supabase, profile.id, 'temp.bulk_added', `Bulk added ${data.length} temps from CSV. ${res.sent} welcome texts sent${res.failed ? `, ${res.failed} failed` : ''}`);
  revalidatePath('/temps');
  return { ok: true, added: data.length, skipped, message: `${data.length} temps added. ${res.sent} welcome texts sent${res.failed ? `, ${res.failed} failed` : ''}.` };
}

export async function setTempStatus(id: string, status: 'active' | 'hold'): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const { data: t } = await supabase.from('temps').select('first_name,last_name,status').eq('id', id).single();
  if (!t) return { ok: false, error: 'Temp not found.' };
  if (status === 'active' && t.status !== 'hold') return { ok: false, error: 'Only temps on hold can be reactivated. New temps become active when they opt in.' };
  await supabase.from('temps').update({ status }).eq('id', id);
  await audit(supabase, profile.id, status === 'hold' ? 'temp.hold' : 'temp.reactivated', `${status === 'hold' ? 'Put' : 'Reactivated'} ${t.first_name} ${t.last_name}${status === 'hold' ? ' on hold' : ''}`);
  revalidatePath('/temps');
  return { ok: true };
}

export async function resendWelcome(id: string): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const { data: t } = await supabase.from('temps').select('*').eq('id', id).single();
  if (!t || t.status !== 'pending') return { ok: false, error: 'Only temps awaiting opt-in can be sent the welcome again.' };
  const r = await sendSms({ db: supabase, to: t.mobile, body: welcomeText(t.first_name, t.optin_token), kind: 'welcome', tempId: t.id, sentBy: profile.id });
  await audit(supabase, profile.id, 'temp.welcome_resent', `Resent welcome text to ${t.first_name} ${t.last_name}`);
  revalidatePath('/temps');
  return r.ok ? { ok: true, message: 'Welcome text resent.' } : { ok: false, error: `Text failed: ${r.error}` };
}

/** GDPR: permanently remove a temp's record (admins only). Their texts stay as an anonymous count, with numbers and wording removed. */
export async function deleteTemp(id: string): Promise<Result> {
  const { supabase, profile } = await requireStaff({ admin: true });
  const { data: t } = await supabase.from('temps').select('first_name,last_name').eq('id', id).single();
  if (!t) return { ok: false, error: 'Temp not found.' };
  await supabase.from('messages').update({ to_number: null, from_number: null, body: '[removed: temp deleted]' }).eq('temp_id', id);
  const { error } = await supabase.from('temps').delete().eq('id', id);
  if (error) return { ok: false, error: 'Couldn’t delete this temp.' };
  await audit(supabase, profile.id, 'temp.deleted', `Deleted ${t.first_name} ${t.last_name} and their personal data`);
  revalidatePath('/temps');
  return { ok: true };
}

export async function sendBulkText(ids: string[], body: string): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const text = body.trim();
  if (!text) return { ok: false, error: 'Write a message first.' };
  if (text.length > 600) return { ok: false, error: 'Keep the message under 600 characters.' };
  const { data: temps } = await supabase.from('temps').select('id,first_name,mobile,status').in('id', ids.slice(0, 5000));
  const active = (temps ?? []).filter((t) => t.status === 'active');
  if (!active.length) return { ok: false, error: 'None of the selected temps have opted in, so no texts were sent.' };
  const res = await sendMany(
    active.map((t) => ({ db: supabase, to: t.mobile, body: text.replace(/\{first\}/g, t.first_name), kind: 'bulk', tempId: t.id, sentBy: profile.id })),
  );
  await audit(supabase, profile.id, 'sms.bulk', `Sent bulk text to ${res.sent} temps: "${text.slice(0, 60)}${text.length > 60 ? '...' : ''}"`);
  revalidatePath('/temps');
  return { ok: true, message: `Sent to ${res.sent} temp${res.sent === 1 ? '' : 's'}${res.failed ? `. ${res.failed} failed` : ''}.` };
}

export async function lookupPostcode(pc: string) {
  await requireStaff();
  return geocodePostcode(pc);
}
