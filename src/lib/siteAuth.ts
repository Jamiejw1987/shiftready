import 'server-only';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Site supervisor logins: a username and password, nothing else. They can only see the temps booked on
 * today's shifts (for their client, if one is set) and upload the photo of the signed day-one sheet.
 * Separate from staff sign-in on purpose: no access to temps' records, pay or documents.
 */

export const COOKIE = 'sr_site';
const HOURS = 14;

export type Supervisor = { id: string; username: string; full_name: string; client_id: string | null; session_version: number };

export function hashPassword(pw: string) {
  const salt = randomBytes(16);
  return `s1:${salt.toString('base64')}:${scryptSync(pw, salt, 32).toString('base64')}`;
}
export function checkPassword(pw: string, stored: string) {
  const [v, salt, hash] = stored.split(':');
  if (v !== 's1' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const got = scryptSync(pw, Buffer.from(salt, 'base64'), want.length);
  return timingSafeEqual(want, got);
}
export const passwordProblem = (pw: string) => (pw.length < 10 ? 'Use at least 10 characters.' : null);

function secret() {
  const s = process.env.SITE_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!s) throw new Error('No session secret');
  return createHmac('sha256', s).update('shiftready-site-session').digest();
}
const sign = (body: string) => createHmac('sha256', secret()).update(body).digest('base64url');

export function sessionValue(s: Pick<Supervisor, 'id' | 'session_version'>) {
  const body = Buffer.from(JSON.stringify({ i: s.id, v: s.session_version, e: Date.now() + HOURS * 3600e3 })).toString('base64url');
  return `${body}.${sign(body)}`;
}
export const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge: HOURS * 3600 };

/** The signed-in supervisor, or null. */
export async function currentSupervisor(): Promise<Supervisor | null> {
  const raw = cookies().get(COOKIE)?.value;
  if (!raw) return null;
  const [body, mac] = raw.split('.');
  if (!body || !mac) return null;
  const want = Buffer.from(sign(body)), got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  let p: { i: string; v: number; e: number };
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (!p.e || p.e < Date.now()) return null;
  const { data } = await createAdminClient().from('site_supervisors').select('id,username,full_name,client_id,session_version,active').eq('id', p.i).maybeSingle();
  if (!data || !data.active || data.session_version !== p.v) return null;
  return data as Supervisor;
}

export async function requireSupervisor(): Promise<Supervisor> {
  const s = await currentSupervisor();
  if (!s) redirect('/site/login');
  return s;
}

/** Shifts a supervisor can see today: today's, plus yesterday's (night shifts run past midnight). */
export function siteDays() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const y = new Date(Date.parse(today + 'T12:00:00Z') - 864e5).toISOString().slice(0, 10);
  return { today, yesterday: y };
}
