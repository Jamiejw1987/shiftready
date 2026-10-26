'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { encrypt, encryptionReady } from '@/lib/crypto';
import { currentDocs, docProblems } from '@/lib/docs';
import { geocodePostcode, looksLikePostcode, normalisePostcode } from '@/lib/geo';
import { JOB_TYPES, PPE_OPTIONS } from '@/lib/format';
import { sendSms } from '@/lib/sms';
import { uploadSlots, recordUploads } from '@/lib/storage';
import { AVAILABILITY, TRANSPORT } from '@/lib/regOptions';

const UUID = /^[0-9a-f-]{36}$/i;

export type RegData = {
  first: string; last: string; dob: string; email: string;
  address1: string; address2: string; town: string; postcode: string; ni: string;
  jobTypes: string[]; experience: string; transport: string; ownPpe: string[]; availability: string[];
  rtwRoute: 'british_irish' | 'share_code' | ''; shareCode: string;
  nokName: string; nokRelationship: string; nokPhone: string;
  healthDeclared: boolean | null; healthDetails: string;
  convictionsDeclared: boolean | null; convictionsDetails: string;
  wtrOptOut: boolean | null;
  readKid: boolean; readTerms: boolean; readPrivacy: boolean; messagesConsent: boolean;
  signature: string;
};


/** The temp behind a registration link, if the form is open for them. */
async function openTemp(token: string) {
  if (!UUID.test(token)) return null;
  const db = createAdminClient();
  const { data: t } = await db.from('temps').select('id,first_name,last_name,mobile,status,added_by,reg_requested_at,registered_at').eq('reg_token', token).maybeSingle();
  if (!t) return null;
  const open = !t.registered_at && (t.status === 'invited' || t.reg_requested_at);
  return open ? { db, t } : null;
}

export async function startUploads(token: string, files: { kind: string; type: string; size: number }[]) {
  const o = await openTemp(token);
  if (!o) return { ok: false as const, error: 'This registration link is no longer open.' };
  return uploadSlots(o.db, o.t.id, files);
}

const clean = (s: string, n = 200) => (s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const age = (dob: string) => {
  const d = new Date(dob + 'T12:00:00Z'), now = new Date();
  let a = now.getUTCFullYear() - d.getUTCFullYear();
  if (now.getUTCMonth() < d.getUTCMonth() || (now.getUTCMonth() === d.getUTCMonth() && now.getUTCDate() < d.getUTCDate())) a--;
  return a;
};

export async function submitRegistration(token: string, r: RegData, uploads: { kind: string; path: string; filename?: string }[]) {
  const o = await openTemp(token);
  if (!o) return { ok: false, error: 'This registration link is no longer open. Please call the office.' };
  const { db, t } = o;
  if (!encryptionReady()) return { ok: false, error: 'Registration is temporarily unavailable. Please call the office.' };
  const docs = await currentDocs(db);
  if (docProblems(docs).length) return { ok: false, error: 'Registration isn’t open yet. Please call the office.' };

  // ---- check everything ----
  const p: string[] = [];
  const first = clean(r.first, 60), last = clean(r.last, 60);
  if (!first || !last) p.push('your first name and surname');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.dob) || age(r.dob) < 16 || age(r.dob) > 90) p.push('your date of birth (you must be 16 or over)');
  if (r.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email.trim())) p.push('a valid email address, or leave it blank');
  if (!clean(r.address1) || !clean(r.town)) p.push('your address');
  if (!looksLikePostcode(r.postcode)) p.push('your full postcode');
  const ni = r.ni.replace(/\s+/g, '').toUpperCase();
  if (ni && !/^[A-Z]{2}\d{6}[A-D]$/.test(ni)) p.push('your National Insurance number (like QQ123456C), or leave it blank');
  const jobTypes = r.jobTypes.filter((x) => (JOB_TYPES as readonly string[]).includes(x));
  if (!jobTypes.length) p.push('at least one type of work');
  const shareCode = r.shareCode.replace(/[\s-]+/g, '').toUpperCase();
  if (r.rtwRoute !== 'british_irish' && r.rtwRoute !== 'share_code') p.push('how you’ll prove your right to work');
  if (r.rtwRoute === 'share_code' && !/^[A-Z0-9]{9}$/.test(shareCode)) p.push('your 9-character share code');
  if (r.rtwRoute === 'british_irish' && !uploads.some((u) => u.kind === 'passport' || u.kind === 'id')) p.push('a photo of your passport');
  if (!clean(r.nokName) || !/^[+\d\s()-]{7,20}$/.test(r.nokPhone || '')) p.push('your emergency contact’s name and phone number');
  if (r.healthDeclared === null) p.push('an answer to the health and safety question');
  if (r.convictionsDeclared === null) p.push('an answer to the convictions question');
  if (r.wtrOptOut === null) p.push('your choice about the 48-hour week');
  if (!r.readKid || !r.readTerms || !r.readPrivacy) p.push('ticks to confirm you’ve read the documents');
  const sig = clean(r.signature, 120);
  if (!sig || !sig.toLowerCase().includes(last.toLowerCase())) p.push('your full name as your signature');
  if (p.length) return { ok: false, error: 'Please add ' + p.join(', ') + '.' };

  const postcode = normalisePostcode(r.postcode);
  const point = await geocodePostcode(postcode);
  if (!point) return { ok: false, error: `We couldn’t find the postcode ${postcode}. Please check it.` };

  // ---- save ----
  const now = new Date().toISOString();
  const ip = (headers().get('x-forwarded-for') || '').split(',')[0].trim().slice(0, 60) || null;
  const under18 = age(r.dob) < 18;
  const needsAdmin = Boolean(r.healthDeclared || r.convictionsDeclared || under18);

  const { error: pe } = await db.from('temp_profiles').upsert({
    temp_id: t.id, dob: r.dob, email: clean(r.email, 120) || null,
    address1: clean(r.address1), address2: clean(r.address2) || null, town: clean(r.town, 80),
    ni_enc: ni ? encrypt(ni) : null,
    experience: clean(r.experience, 1000) || null, transport: TRANSPORT.includes(r.transport) ? r.transport : null,
    own_ppe: r.ownPpe.filter((x) => (PPE_OPTIONS as readonly string[]).includes(x)),
    availability: r.availability.filter((x) => AVAILABILITY.includes(x)),
    share_code: r.rtwRoute === 'share_code' ? shareCode : null,
    nok_name: clean(r.nokName, 80), nok_relationship: clean(r.nokRelationship, 40) || null, nok_phone: clean(r.nokPhone, 20),
    health_enc: encrypt({ declared: !!r.healthDeclared, details: r.healthDeclared ? clean(r.healthDetails, 2000) : '' }),
    convictions_enc: encrypt({ declared: !!r.convictionsDeclared, details: r.convictionsDeclared ? clean(r.convictionsDetails, 2000) : '' }),
    wtr_opt_out: r.wtrOptOut, wtr_changed_at: now, wtr_effective: now.slice(0, 10),
    privacy_ack_at: now, messages_consent: r.messagesConsent,
    signature_name: sig, signed_at: now, signed_ip: ip, submitted_at: now, updated_at: now,
  });
  if (pe) return { ok: false, error: 'Something went wrong saving your details. Please try again.' };

  const sigs = [docs.kid!, docs.terms!, docs.privacy!].map((d) => ({ temp_id: t.id, document_id: d.id, action: 'signed', signed_name: sig, ip }));
  if (r.wtrOptOut) sigs.push({ temp_id: t.id, document_id: docs.wtr!.id, action: 'wtr_opt_out', signed_name: sig, ip });
  await db.from('temp_signatures').insert(sigs);
  await recordUploads(db, t.id, uploads, null);

  const update: Record<string, unknown> = {
    first_name: first, last_name: last, postcode, lat: point.lat, lng: point.lng, job_types: jobTypes,
    rtw_route: r.rtwRoute, registered_at: now, needs_admin_review: needsAdmin,
  };
  if (t.status === 'invited') update.status = 'review';
  else if (!r.messagesConsent && t.status !== 'out') { update.status = 'out'; update.opted_out_at = now; }
  await db.from('temps').update(update).eq('id', t.id);
  await db.from('audit_log').insert({ actor: null, action: 'temp.registered', detail: `${first} ${last} completed their registration${needsAdmin ? ' (needs an admin to review)' : ''}` });

  if (t.added_by) {
    const { data: c } = await db.from('profiles').select('mobile').eq('id', t.added_by).maybeSingle();
    if (c?.mobile) await sendSms({ db, to: c.mobile, kind: 'system', body: `ShiftReady: ${first} ${last} has registered and is ready for you to check.` });
  }
  revalidatePath(`/r/${token}`);
  return { ok: true };
}

/** Candidate opts out of, or back into, the 48-hour limit from their link. Withdrawing takes 7 days' notice. */
export async function changeWtr(token: string, optOut: boolean, signature: string) {
  if (!UUID.test(token)) return { ok: false, error: 'Link not valid.' };
  const db = createAdminClient();
  const { data: t } = await db.from('temps').select('id,first_name,last_name').eq('reg_token', token).maybeSingle();
  if (!t) return { ok: false, error: 'Link not valid.' };
  const { data: prof } = await db.from('temp_profiles').select('wtr_opt_out,submitted_at').eq('temp_id', t.id).maybeSingle();
  if (!prof?.submitted_at) return { ok: false, error: 'Please finish registering first.' };
  if (prof.wtr_opt_out === optOut) return { ok: true };
  const sig = clean(signature, 120);
  if (!sig || !sig.toLowerCase().includes(t.last_name.toLowerCase())) return { ok: false, error: 'Type your full name to confirm.' };
  const docs = await currentDocs(db);
  if (!docs.wtr) return { ok: false, error: 'Please call the office.' };
  const now = new Date();
  const effective = optOut ? now : new Date(now.getTime() + 7 * 864e5);
  await db.from('temp_profiles').update({ wtr_opt_out: optOut, wtr_changed_at: now.toISOString(), wtr_effective: effective.toISOString().slice(0, 10), updated_at: now.toISOString() }).eq('temp_id', t.id);
  const ip = (headers().get('x-forwarded-for') || '').split(',')[0].trim().slice(0, 60) || null;
  await db.from('temp_signatures').insert({ temp_id: t.id, document_id: docs.wtr.id, action: optOut ? 'wtr_opt_out' : 'wtr_withdraw', signed_name: sig, ip });
  await db.from('audit_log').insert({
    actor: null, action: optOut ? 'temp.wtr_opt_out' : 'temp.wtr_withdraw',
    detail: optOut ? `${t.first_name} ${t.last_name} opted out of the 48-hour week` : `${t.first_name} ${t.last_name} cancelled their 48-hour opt-out (effective ${effective.toLocaleDateString('en-GB')})`,
  });
  revalidatePath(`/r/${token}`);
  return { ok: true };
}
