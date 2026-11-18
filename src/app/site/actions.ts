'use server';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { COOKIE, checkPassword, cookieOptions, currentSupervisor, sessionValue } from '@/lib/siteAuth';
import { supervisorCanSee } from '@/lib/siteData';
import { siteSlot, recordSite } from '@/lib/inductionOps';
import { IND_COLS, type TempInduction } from '@/lib/inductions';

type Result = { ok: boolean; error?: string; message?: string };

export async function siteSignIn(_: unknown, form: FormData): Promise<{ error: string } | undefined> {
  const username = String(form.get('username') ?? '').trim().toLowerCase().slice(0, 60);
  const password = String(form.get('password') ?? '').slice(0, 200);
  const db = createAdminClient();
  const { data: s } = await db.from('site_supervisors').select('id,full_name,password_hash,active,session_version').eq('username', username).maybeSingle();
  const ok = !!s && s.active && checkPassword(password, s.password_hash);
  const ip = (headers().get('x-forwarded-for') || '').split(',')[0].trim().slice(0, 60);
  await db.from('audit_log').insert({ actor: null, action: ok ? 'site_supervisor.signed_in' : 'site_supervisor.sign_in_failed', detail: `Site login ${username || '(blank)'}${ip ? ` from ${ip}` : ''}` });
  if (!ok) { await new Promise((r) => setTimeout(r, 800)); return { error: 'Wrong username or password.' }; }
  await db.from('site_supervisors').update({ last_login_at: new Date().toISOString() }).eq('id', s!.id);
  cookies().set(COOKIE, sessionValue(s!), cookieOptions);
  redirect('/site');
}

export async function siteSignOut() {
  cookies().delete(COOKIE);
  redirect('/site/login');
}

async function allowed(inductionId: string) {
  const sup = await currentSupervisor();
  if (!sup || !(await supervisorCanSee(sup, inductionId))) return null;
  const { data } = await createAdminClient().from('temp_inductions').select(IND_COLS).eq('id', inductionId).maybeSingle();
  const i = data as TempInduction | null;
  return i && !i.cancelled_at ? { sup, i } : null;
}

export async function siteUploadSlot(inductionId: string, type: string, size: number) {
  const a = await allowed(inductionId);
  if (!a) return { ok: false as const, error: 'You can only upload for people booked on today’s shifts.' };
  return siteSlot(a.i.temp_id, type, size);
}

export async function siteRecordUpload(inductionId: string, paths: { path: string; filename: string }[]): Promise<Result> {
  const a = await allowed(inductionId);
  if (!a) return { ok: false, error: 'You can only upload for people booked on today’s shifts.' };
  const n = await recordSite(a.i, paths, { supervisor: a.sup.id });
  if (!n) return { ok: false, error: 'The photo didn’t arrive. Try again.' };
  const db = createAdminClient();
  const { data: t } = await db.from('temps').select('first_name,last_name').eq('id', a.i.temp_id).single();
  await db.from('audit_log').insert({ actor: null, action: 'induction.site_uploaded', detail: `${a.sup.full_name} (site login ${a.sup.username}) uploaded the day-one sign-off for ${t?.first_name} ${t?.last_name}` });
  return { ok: true, message: `Saved to ${t?.first_name}’s file.` };
}

/** Manual handling practical assessment done on site by the supervisor. */
export async function saveMhSite(inductionId: string, p: import('@/lib/mhAssessment').MhInput): Promise<Result> {
  const a = await allowed(inductionId);
  if (!a) return { ok: false, error: 'You can only do this for people booked on today’s shifts.' };
  const { saveMh } = await import('@/lib/mhAssessment');
  const ip = (headers().get('x-forwarded-for') || '').split(',')[0].trim().slice(0, 60) || null;
  const r = await saveMh(createAdminClient(), a.i, p, { supervisor: a.sup.id, ip });
  if (!r.ok) return r;
  await createAdminClient().from('audit_log').insert({ actor: null, action: 'induction.mh_assessment', detail: `${a.sup.full_name} (site login ${a.sup.username}) recorded the manual handling assessment for ${r.name}` });
  return { ok: true, message: r.message };
}

/** DHL's day-one sign-off done on screen by the supervisor and the worker. */
export async function saveDayOneSite(inductionId: string, p: import('@/lib/dayOneItems').DayOneInput): Promise<Result> {
  const a = await allowed(inductionId);
  if (!a) return { ok: false, error: 'You can’t do this one. Call the office.' };
  const { saveDayOne } = await import('@/lib/dayOne');
  const ip = (headers().get('x-forwarded-for') || '').split(',')[0].trim().slice(0, 60) || null;
  const r = await saveDayOne(createAdminClient(), a.i, p, { supervisor: a.sup.id, ip });
  if (!r.ok) return r;
  await createAdminClient().from('audit_log').insert({ actor: null, action: 'induction.day_one', detail: `${a.sup.full_name} (site login ${a.sup.username}) completed the day-one sign-off for ${r.name}` });
  return { ok: true, message: r.message };
}
