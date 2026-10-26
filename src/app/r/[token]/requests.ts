'use server';
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { alertPayroll } from '@/lib/payroll';
import { holidayRange } from '@/lib/texts';

const UUID = /^[0-9a-f-]{36}$/i;
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });

/** The registered temp behind a link, if they can make requests. */
async function tempFor(token: string) {
  if (!UUID.test(token)) return null;
  const db = createAdminClient();
  const { data: t } = await db.from('temps').select('id,first_name,last_name,status,registered_at').eq('reg_token', token).maybeSingle();
  if (!t?.registered_at || t.status === 'invited' || t.status === 'review') return null;
  return { db, t };
}

export async function requestHoliday(token: string, r: { start: string; end: string; days: string; note: string }) {
  const o = await tempFor(token);
  if (!o) return { ok: false, error: 'This link can’t be used for requests. Please call the office.' };
  const { db, t } = o;
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(r.start) || !re.test(r.end)) return { ok: false, error: 'Choose the first and last day of your holiday.' };
  if (r.start < today()) return { ok: false, error: 'Holiday can’t start in the past.' };
  if (r.end < r.start) return { ok: false, error: 'The last day must be on or after the first day.' };
  const span = Math.round((Date.parse(r.end) - Date.parse(r.start)) / 864e5) + 1;
  if (span > 60) return { ok: false, error: 'For more than 60 days, please call the office.' };
  const days = Math.round(parseFloat(r.days) * 2) / 2;
  if (!(days >= 0.5 && days <= span)) return { ok: false, error: `Enter how many working days you’re taking off (up to ${span}).` };
  const { count } = await db.from('temp_requests').select('id', { count: 'exact', head: true }).eq('temp_id', t.id).eq('status', 'pending');
  if ((count ?? 0) >= 5) return { ok: false, error: 'You already have 5 requests waiting. Please wait for those to be answered.' };
  const note = r.note.replace(/\s+/g, ' ').trim().slice(0, 500) || null;
  await db.from('temp_requests').insert({ temp_id: t.id, kind: 'holiday', start_date: r.start, end_date: r.end, days, note });
  await db.from('audit_log').insert({ actor: null, action: 'request.holiday', detail: `${t.first_name} ${t.last_name} requested ${days} day${days === 1 ? '' : 's'} holiday, ${holidayRange(r.start, r.end)}` });
  await alertPayroll(db, `ShiftReady: ${t.first_name} ${t.last_name} has requested holiday, ${holidayRange(r.start, r.end)} (${days} day${days === 1 ? '' : 's'}). Open Requests to approve or decline.`);
  revalidatePath(`/r/${token}`);
  return { ok: true };
}

export async function requestP45(token: string, r: { lastDay: string; delivery: 'email' | 'post'; note: string }) {
  const o = await tempFor(token);
  if (!o) return { ok: false, error: 'This link can’t be used for requests. Please call the office.' };
  const { db, t } = o;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.lastDay)) return { ok: false, error: 'Choose your last day working with us.' };
  if (r.delivery !== 'email' && r.delivery !== 'post') return { ok: false, error: 'Choose email or post.' };
  const { count } = await db.from('temp_requests').select('id', { count: 'exact', head: true }).eq('temp_id', t.id).eq('kind', 'p45').eq('status', 'pending');
  if (count) return { ok: false, error: 'You’ve already asked for your P45. We’ll text you when it’s sent.' };
  const note = r.note.replace(/\s+/g, ' ').trim().slice(0, 500) || null;
  await db.from('temp_requests').insert({ temp_id: t.id, kind: 'p45', last_day: r.lastDay, delivery: r.delivery, note });
  await db.from('audit_log').insert({ actor: null, action: 'request.p45', detail: `${t.first_name} ${t.last_name} requested their P45 (last day ${r.lastDay}, by ${r.delivery})` });
  await alertPayroll(db, `ShiftReady: ${t.first_name} ${t.last_name} has requested their P45 (by ${r.delivery}). Open Requests to deal with it.`);
  revalidatePath(`/r/${token}`);
  return { ok: true };
}
