import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { toE164 } from './phone';
import { sendToTemp } from './sms';
import { appUrl } from './texts';
import { currentDocs, docProblems } from './docs';
import { encryptionReady } from './crypto';
import { DEFAULT_APPLY_MESSAGE, APPLY_MESSAGE_KEY, renderApplyMessage } from './applyMessage';
import { sendEmail, applyEmail } from './email';

type Json = Record<string, unknown>;
const str = (v: unknown, max = 200) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\s+/g, ' ').trim().slice(0, max) : '');
const pick = (objs: Json[], ...keys: string[]) => {
  for (const o of objs) for (const k of keys) { const v = str(o?.[k]); if (v) return v; }
  return '';
};
const titleCase = (s: string) => (s && (s === s.toUpperCase() || s === s.toLowerCase()) ? s.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase()) : s);

export type ParsedApplication = {
  externalId: string; jobRef: string; jobTitle: string; first: string; last: string; email: string;
  phoneRaw: string; mobile: string | null; postcode: string; town: string;
  cv: { name: string; type: string; bytes: Buffer } | null; payload: Json;
};

const SIGS: [string, string, string][] = [
  ['%PDF', 'application/pdf', 'pdf'],
  ['PK\u0003\u0004', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ['ÐÏ\u0011à', 'application/msword', 'doc'],
  ['{\\rtf', 'application/rtf', 'rtf'],
];

/** Works out what file a CV field holds: a base64 PDF/Word/RTF file, or plain text. */
function readCv(content: string, filename: string): { name: string; type: string; bytes: Buffer } | null {
  if (!content) return null;
  const b64 = content.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  if (/^[A-Za-z0-9+/=]+$/.test(b64) && b64.length >= 16) {
    const bytes = Buffer.from(b64, 'base64');
    const head = bytes.subarray(0, 5).toString('latin1');
    const sig = SIGS.find(([s]) => head.startsWith(s));
    if (sig) return { name: safeName(filename, sig[2]), type: sig[1], bytes };
  }
  return { name: safeName(filename.replace(/\.[a-z0-9]+$/i, ''), 'txt'), type: 'text/plain', bytes: Buffer.from(content, 'utf8') };
}
const safeName = (name: string, ext: string) => {
  const base = (name || 'cv').replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[^a-z0-9 _-]/gi, '').trim().slice(0, 60) || 'cv';
  return `${base}.${ext}`;
};

/**
 * Reads an application from CV-Library / Resume-Library DirectApply. Field names vary a little between boards
 * and versions, so this looks in the usual places rather than expecting one exact shape.
 */
export function parseApplication(body: Json, query: URLSearchParams): ParsedApplication {
  const c = (body.candidate ?? body.applicant ?? {}) as Json;
  const j = (body.job ?? body.vacancy ?? {}) as Json;
  const objs = [body, c, j];
  const full = pick(objs, 'name', 'full_name', 'fullname');
  let first = pick(objs, 'first_name', 'firstname', 'firstName', 'forename');
  let last = pick(objs, 'last_name', 'lastname', 'lastName', 'surname');
  if (!first && full) { const parts = full.split(' '); first = parts[0]; last = last || parts.slice(1).join(' '); }
  const phoneRaw = pick(objs, 'mobile', 'mobile_phone', 'phone', 'telephone', 'phone_number', 'contact_number');

  // The CV: Resume-Library sends result.pages[{content, filename}]; others send cv/resume objects or strings.
  let cv: ParsedApplication['cv'] = null;
  const result = (body.result ?? c.result) as Json | undefined;
  const pages = Array.isArray(result?.pages) ? (result!.pages as Json[]) : [];
  const fileFields = [body.cv, body.resume, c.cv, c.resume, body.attachment, body.file].filter(Boolean);
  if (pages.length) {
    const fname = str(result?.original_filename, 120) || str(pages[0]?.filename, 120);
    cv = pages.length === 1 ? readCv(String(pages[0]?.content ?? ''), fname) : readCv(pages.map((p) => String(p?.content ?? '')).join('\n\n'), fname);
    if (pages.length > 1 && cv?.type !== 'text/plain') cv = readCv(String(pages[0]?.content ?? ''), fname);
  } else {
    for (const f of fileFields) {
      if (typeof f === 'string') { cv = readCv(f, 'cv'); break; }
      const o = f as Json;
      const content = String(o.content ?? o.data ?? o.base64 ?? o.file ?? '');
      if (content) { cv = readCv(content, str(o.filename ?? o.file_name ?? o.name, 120)); break; }
    }
  }

  // Keep what they sent for troubleshooting, minus the CV file itself.
  const payload = JSON.parse(JSON.stringify(body, (k, v) => (['content', 'data', 'base64'].includes(k) && typeof v === 'string' && v.length > 200 ? `[${v.length} characters]` : v))) as Json;

  return {
    externalId: pick(objs, 'application_id', 'id', 'candidate_id', 'record_id') || str(result?.record_id),
    jobRef: str(query.get('job')) || pick([body, j], 'direct_apply_jobid', 'job_ref', 'jobref', 'reference', 'job_reference', 'jobid', 'job_id'),
    jobTitle: str(query.get('title'), 120) || pick([j, body], 'job_title', 'jobtitle', 'title', 'vacancy_title'),
    first: titleCase(first).slice(0, 60),
    last: titleCase(last).slice(0, 60),
    email: pick(objs, 'email', 'email_address').toLowerCase().slice(0, 200),
    phoneRaw,
    mobile: toE164(phoneRaw),
    postcode: pick(objs, 'postcode', 'post_code', 'zip', 'postal_code').toUpperCase().slice(0, 10),
    town: pick(objs, 'town', 'city', 'location').slice(0, 80),
    cv,
    payload,
  };
}

export async function applyMessage(db: SupabaseClient) {
  const { data } = await db.from('app_settings').select('value').eq('key', APPLY_MESSAGE_KEY).maybeSingle();
  return data?.value || DEFAULT_APPLY_MESSAGE;
}

/** Saves the application, adds them to ShiftReady and texts them their registration link. Never throws. */
export async function takeApplication(db: SupabaseClient, source: string, a: ParsedApplication) {
  const row = {
    source, external_id: a.externalId || null, job_ref: a.jobRef || null, job_title: a.jobTitle || null,
    first_name: a.first || null, last_name: a.last || null, email: a.email || null, mobile: a.mobile, phone_raw: a.phoneRaw || null,
    postcode: a.postcode || null, town: a.town || null, payload: a.payload,
  };

  // The same person applying to the same job twice (a board retrying) is only taken once.
  if (a.externalId) {
    let q = db.from('job_applications').select('id').eq('source', source).eq('external_id', a.externalId);
    q = a.jobRef ? q.eq('job_ref', a.jobRef) : q.is('job_ref', null);
    const { data: dup } = await q.limit(1).maybeSingle();
    if (dup) return { id: dup.id as string, outcome: 'duplicate' };
  }
  const { data: app, error } = await db.from('job_applications').insert(row).select('id').single();
  if (error || !app) return { id: null, outcome: 'error', error: error?.message };
  if (a.cv) {
    const path = `applications/${app.id}/${a.cv.name}`;
    const up = await db.storage.from('documents').upload(path, a.cv.bytes, { contentType: a.cv.type, upsert: true });
    if (!up.error) await db.from('job_applications').update({ cv_path: path, cv_name: a.cv.name }).eq('id', app.id);
  }
  const outcome = await inviteApplicant(db, { id: app.id, source, first: a.first, last: a.last, mobile: a.mobile, phoneRaw: a.phoneRaw, jobTitle: a.jobTitle, email: a.email });
  return { id: app.id as string, outcome };
}

/** Adds an applicant to ShiftReady and texts them their registration link, recording what happened. */
export async function inviteApplicant(
  db: SupabaseClient,
  a: { id: string; source: string; first: string; last: string; mobile: string | null; phoneRaw: string; jobTitle: string; email?: string | null },
): Promise<string> {
  const done = async (outcome: string, extra: Json = {}) => {
    await db.from('job_applications').update({ outcome, detail: null, ...extra }).eq('id', a.id);
    return outcome;
  };
  if (!a.mobile) {
    // No UK mobile to text: email them the public registration link instead (they applied, so this is fine to send).
    if (a.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.email)) {
      const { data: prev } = await db.from('job_applications').select('id').eq('email', a.email).eq('outcome', 'emailed')
        .gte('created_at', new Date(Date.now() - 600e3).toISOString()).neq('id', a.id).limit(1).maybeSingle();
      if (prev) return done('emailed', { detail: 'Emailed in the last 10 minutes, so not emailed again' });
      const src = a.source.replace(/[^a-z0-9-]/gi, '');
      const m = applyEmail({ first: a.first, job: a.jobTitle, link: `${appUrl()}/join?from=${src}` });
      const r = await sendEmail({ to: a.email, ...m, tag: 'apply-invite' });
      await db.from('audit_log').insert({ actor: null, action: 'temp.applied', detail: `${a.first} ${a.last} applied on ${a.source === 'cv-library' ? 'CV-Library' : a.source}${a.jobTitle ? ` for ${a.jobTitle}` : ''}${r.ok ? ' and was emailed the registration link (no UK mobile found)' : ' - email failed'}` });
      return r.ok ? done('emailed', { detail: r.status === 'dry-run' ? 'Email not configured (dry run)' : null }) : done('failed', { detail: `Email failed: ${r.error}` });
    }
    return done('no_mobile', { detail: a.phoneRaw ? 'Not a UK mobile number' : 'No phone number given' });
  }
  if (!a.first) return done('not_sent', { detail: 'No name given' });

  const { data: existing } = await db.from('temps').select('id,first_name,mobile,status,reg_token,registered_at,reg_requested_at').eq('mobile', a.mobile).maybeSingle();
  if (existing) {
    if (existing.status === 'out') return done('opted_out', { temp_id: existing.id });
    if (existing.registered_at) return done('already_registered', { temp_id: existing.id });
  }
  if (!encryptionReady() || docProblems(await currentDocs(db)).length) {
    return done('not_sent', { temp_id: existing?.id ?? null, detail: 'Registration was switched off (documents or encryption key not ready)' });
  }

  let temp = existing;
  if (!temp) {
    const { data: t, error: e } = await db.from('temps')
      .insert({ first_name: a.first, last_name: a.last || '-', mobile: a.mobile, status: 'invited', job_types: [], reg_requested_at: new Date().toISOString() })
      .select('id,first_name,mobile,status,reg_token,registered_at,reg_requested_at').single();
    if (e || !t) return done('failed', { detail: 'Couldn’t add them to ShiftReady' });
    temp = t;
  } else {
    // Already invited: don't text them more than once in 10 minutes.
    const tenAgo = new Date(Date.now() - 600e3).toISOString();
    const { count } = await db.from('messages').select('id', { count: 'exact', head: true }).eq('temp_id', temp.id).eq('direction', 'out').gte('created_at', tenAgo);
    if (count) return done('resent', { temp_id: temp.id, detail: 'Texted in the last 10 minutes, so not texted again' });
    if (!temp.reg_requested_at) await db.from('temps').update({ reg_requested_at: new Date().toISOString() }).eq('id', temp.id);
  }

  const body = renderApplyMessage(await applyMessage(db), { first: temp.first_name, job: a.jobTitle, token: temp.reg_token });
  const r = await sendToTemp({ db, temp, kind: 'registration', body });
  await db.from('audit_log').insert({ actor: null, action: 'temp.applied', detail: `${a.first} ${a.last} applied on ${a.source === 'cv-library' ? 'CV-Library' : a.source}${a.jobTitle ? ` for ${a.jobTitle}` : ''}${r.ok ? ' and was texted their registration link' : ' - text failed'}` });
  return done(r.ok ? (existing ? 'resent' : 'texted') : 'failed', { temp_id: temp.id, detail: r.ok ? null : `Text failed: ${r.error}` });
}

export const applyEndpoint = (key: string) => `${appUrl()}/api/apply/cv-library?key=${key}`;
