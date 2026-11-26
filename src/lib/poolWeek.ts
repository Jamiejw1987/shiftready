import type { SupabaseClient } from '@supabase/supabase-js';
import { sendSms, sendMany } from './sms';
import { appUrl } from './texts';

/**
 * Weekly pool availability. Every Friday 8am everyone in a pool is texted a link to tick the days they want shifts
 * the following week; a reminder goes Saturday 12pm to anyone who hasn't replied; answers close Sunday night.
 * Days they can do = (worker_days + office_on) - office_off: the office can add or take off days after a call.
 */

/** London wall clock now: date (YYYY-MM-DD), weekday (1 = Mon ... 7 = Sun) and hour. */
export function londonNow(at = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })
    .formatToParts(at).map((x) => [x.type, x.value]));
  const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) + 1;
  return { date: `${p.year}-${p.month}-${p.day}`, dow, hour: +p.hour, minute: +p.minute };
}

export const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Monday of the week this date is in. */
export const mondayOf = (iso: string) => addDays(iso, 1 - (new Date(iso + 'T12:00:00Z').getUTCDay() || 7));

/** The week people are asked about: the Monday after today. */
export const nextWeek = (today = londonNow().date) => addDays(mondayOf(today), 7);

/** Answers close Sunday night: from the Monday itself the link is read-only (the office can still change days). */
export const weekClosed = (weekStart: string, today = londonNow().date) => today >= weekStart;

export const weekLabel = (weekStart: string) => `w/c ${new Date(weekStart + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;

/** The days someone can do that week, after office changes. */
export function effectiveDays(r: { worker_days?: number[] | null; office_on?: number[] | null; office_off?: number[] | null } | null | undefined) {
  if (!r) return [] as number[];
  const off = new Set(r.office_off ?? []);
  return [...new Set([...(r.worker_days ?? []), ...(r.office_on ?? [])])].filter((d) => !off.has(d)).sort();
}

const askText = (first: string, week: string, token: string) =>
  `Hi ${first}, which days do you want shifts next week (${weekLabel(week)})? Tick them here by Sunday night: ${appUrl()}/w/${token} - Staff Selection`;
const remindText = (first: string, week: string, token: string) =>
  `Hi ${first}, a reminder to tell us which days you want shifts next week (${weekLabel(week)}). It closes Sunday night: ${appUrl()}/w/${token} - Staff Selection`;

type Temp = { id: string; first_name: string; mobile: string; status: string; no_comms?: boolean | null };

/** Everyone in at least one pool who can be texted: opted in, not on hold, messages not switched off. */
async function poolTemps(db: SupabaseClient) {
  const ids = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('pool_members').select('temp_id').range(from, from + 999);
    (data ?? []).forEach((m) => ids.add(m.temp_id));
    if (!data || data.length < 1000) break;
  }
  const out: Temp[] = [];
  const list = [...ids];
  for (let i = 0; i < list.length; i += 300) {
    const { data } = await db.from('temps').select('id,first_name,mobile,status,no_comms').in('id', list.slice(i, i + 300));
    out.push(...((data ?? []) as Temp[]).filter((t) => t.status === 'active' && !t.no_comms));
  }
  return out;
}

/** Texts everyone in a pool who hasn't been asked about this week yet. Safe to run again: nobody is asked twice. */
export async function askForWeek(db: SupabaseClient, week: string, sentBy: string | null = null) {
  const temps = await poolTemps(db);
  if (!temps.length) return { sent: 0, failed: 0 };
  let sent = 0, failed = 0;
  for (let i = 0; i < temps.length; i += 200) {
    const batch = temps.slice(i, i + 200);
    // Claim first, so two runs at once can't both text the same person.
    const { data: made } = await db.from('pool_week_asks').upsert(batch.map((t) => ({ temp_id: t.id, week_start: week })), { onConflict: 'temp_id,week_start', ignoreDuplicates: true }).select('id,temp_id,token');
    const byTemp = new Map(batch.map((t) => [t.id, t]));
    const jobs = (made ?? []).map((a) => ({ ...a, t: byTemp.get(a.temp_id)! })).filter((a) => a.t);
    const res = await sendMany(jobs, async (a) => {
      const r = await sendSms({ db, to: a.t.mobile, body: askText(a.t.first_name, week, a.token), kind: 'availability', tempId: a.t.id, sentBy });
      if (r.ok) await db.from('pool_week_asks').update({ sent_at: new Date().toISOString() }).eq('id', a.id);
      return r;
    });
    sent += res.sent; failed += res.failed;
  }
  return { sent, failed };
}

/** Saturday reminder to anyone asked who hasn't replied. Each person is reminded once. */
export async function remindForWeek(db: SupabaseClient, week: string) {
  const { data: claimed } = await db.from('pool_week_asks').update({ reminded_at: new Date().toISOString() })
    .eq('week_start', week).not('sent_at', 'is', null).is('replied_at', null).is('reminded_at', null).select('id,temp_id,token');
  if (!claimed?.length) return { sent: 0, failed: 0 };
  const { data: temps } = await db.from('temps').select('id,first_name,mobile,status,no_comms').in('id', claimed.map((c) => c.temp_id));
  const ok = new Map(((temps ?? []) as Temp[]).filter((t) => t.status === 'active' && !t.no_comms).map((t) => [t.id, t]));
  const jobs = claimed.filter((c) => ok.has(c.temp_id)).map((c) => ({ ...c, t: ok.get(c.temp_id)! }));
  return sendMany(jobs, (a) => sendSms({ db, to: a.t.mobile, body: remindText(a.t.first_name, week, a.token), kind: 'availability' }));
}
