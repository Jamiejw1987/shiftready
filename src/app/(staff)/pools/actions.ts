'use server';
import { revalidatePath } from 'next/cache';
import { requireStaff, audit } from '@/lib/auth';
import { displayMobile } from '@/lib/phone';
import { sendSms, sendMany } from '@/lib/sms';
import { appUrl } from '@/lib/texts';
import { bookingsNear } from '@/lib/clash';
import { createAdminClient } from '@/lib/supabase/admin';
import { askForWeek, nextWeek, weekLabel } from '@/lib/poolWeek';

type Result = { ok: boolean; error?: string; message?: string };
const SETUP = 'Couldn’t save. Has supabase/2026-11-23b-pools.sql been run in Supabase?';
const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + 'T12:00:00Z'));

/** Temps (by id) who already have a shift on this date, booked or provisionally accepted, with the client. */
async function bookedOn(db: Awaited<ReturnType<typeof requireStaff>>['supabase'], tempIds: string[], date: string) {
  const near = await bookingsNear(db, tempIds, date);
  const out = new Map<string, string>();
  for (const [id, list] of near) { const b = list.find((x) => x.shift_date === date); if (b) out.set(id, b.client); }
  return out;
}

/** Who in this pool already has a shift on this date, so the page can grey them out. */
export async function poolBookedOn(poolId: string, date: string): Promise<Record<string, string>> {
  const { supabase } = await requireStaff();
  if (!isDate(date)) return {};
  const { data } = await supabase.from('pool_members').select('id,temp_id').eq('pool_id', poolId);
  const booked = await bookedOn(supabase, (data ?? []).map((m) => m.temp_id), date);
  return Object.fromEntries((data ?? []).filter((m) => booked.has(m.temp_id)).map((m) => [m.id, booked.get(m.temp_id)!]));
}

const cleanDays = (days: number[]) => [...new Set(days.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort();

/** Which days of the week a pool member wants to work (1 = Mon ... 7 = Sun). */
export async function setPoolDays(memberId: string, days: number[]): Promise<Result> {
  const { supabase } = await requireStaff();
  const { data, error } = await supabase.from('pool_members').update({ days: cleanDays(days), updated_at: new Date().toISOString() }).eq('id', memberId).select('pool_id').maybeSingle();
  if (error || !data) return { ok: false, error: error ? SETUP : 'Not found. Refresh the page.' };
  revalidatePath('/pools');
  return { ok: true };
}

export async function removeFromPool(memberId: string): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const { data: m } = await supabase.from('pool_members').select('pool_id,temps(first_name,last_name),pools(client,site)').eq('id', memberId).maybeSingle();
  if (!m) return { ok: false, error: 'Not found. Refresh the page.' };
  await supabase.from('pool_members').delete().eq('id', memberId);
  const t = m.temps as unknown as { first_name: string; last_name: string } | null;
  const p = m.pools as unknown as { client: string; site: string } | null;
  await audit(supabase, profile.id, 'pool.removed', `Took ${t?.first_name} ${t?.last_name} out of the ${p?.client} (${p?.site}) pool`);
  revalidatePath(`/pools/${m.pool_id}`); revalidatePath('/pools');
  return { ok: true, message: `${t?.first_name ?? 'They'} taken out of the pool.` };
}

/** Temps by name or mobile, to add to a pool by hand. */
export async function findTempsForPool(poolId: string, q: string) {
  const { supabase } = await requireStaff();
  const query = q.trim();
  if (query.length < 2) return [];
  const digits = query.replace(/\D/g, '');
  const { data: temps } = await supabase.from('temps').select('id,first_name,last_name,mobile,postcode,status').in('status', ['active', 'hold', 'pending']).limit(5000);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = (temps ?? []).filter((x) => {
    const name = `${x.first_name} ${x.last_name}`.toLowerCase();
    const mob = displayMobile(x.mobile).replace(/\D/g, '');
    return (digits.length >= 4 && mob.includes(digits.replace(/^44/, '0'))) || (words.length > 0 && words.every((w) => name.includes(w)));
  }).slice(0, 8);
  const { data: on } = hits.length ? await supabase.from('pool_members').select('temp_id').eq('pool_id', poolId).in('temp_id', hits.map((h) => h.id)) : { data: [] };
  const already = new Set((on ?? []).map((o) => o.temp_id));
  return hits.map((x) => ({ id: x.id, name: `${x.first_name} ${x.last_name}`, mobile: displayMobile(x.mobile), postcode: x.postcode, status: x.status, inPool: already.has(x.id) }));
}

export async function addToPool(poolId: string, tempId: string): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const [{ data: p }, { data: x }] = await Promise.all([
    supabase.from('pools').select('client,site').eq('id', poolId).maybeSingle(),
    supabase.from('temps').select('first_name,last_name').eq('id', tempId).maybeSingle(),
  ]);
  if (!p || !x) return { ok: false, error: 'Not found. Refresh the page.' };
  const { error } = await supabase.from('pool_members').insert({ pool_id: poolId, temp_id: tempId, source: 'manual' });
  if (error) return { ok: false, error: error.code === '23505' ? `${x.first_name} is already in this pool.` : SETUP };
  await audit(supabase, profile.id, 'pool.added', `Added ${x.first_name} ${x.last_name} to the ${p.client} (${p.site}) pool`);
  revalidatePath(`/pools/${poolId}`); revalidatePath('/pools');
  return { ok: true, message: `${x.first_name} added.` };
}

/** Mass text to the people ticked in a pool. Only opted-in temps get it; anyone with messages switched off is skipped. */
export async function sendPoolText(poolId: string, memberIds: string[], body: string, date: string): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const text = body.trim();
  if (!isDate(date)) return { ok: false, error: 'Pick the date the shift is on, so anyone already working that day is left out.' };
  if (!text) return { ok: false, error: 'Write a message first.' };
  if (text.length > 600) return { ok: false, error: 'Keep the message under 600 characters.' };
  if (!memberIds.length) return { ok: false, error: 'Tick who to send it to.' };
  const [{ data: p }, { data: members }] = await Promise.all([
    supabase.from('pools').select('client,site').eq('id', poolId).maybeSingle(),
    supabase.from('pool_members').select('temp_id,temps(id,first_name,mobile,status,reg_token)').eq('pool_id', poolId).in('id', memberIds.slice(0, 2000)),
  ]);
  if (!p) return { ok: false, error: 'Pool not found. Refresh the page.' };
  type T = { id: string; first_name: string; mobile: string; status: string; reg_token: string | null };
  const temps = (members ?? []).map((m) => m.temps as unknown as T | null).filter((t): t is T => !!t);
  // Never text anyone who already has a shift that day (booked or provisionally accepted).
  const booked = await bookedOn(supabase, temps.map((t) => t.id), date);
  const active = temps.filter((t) => t.status === 'active' && !booked.has(t.id));
  const busy = temps.filter((t) => booked.has(t.id)).length;
  const notIn = temps.length - active.length - busy;
  if (!active.length) return { ok: false, error: busy ? 'Everyone ticked already has a shift that day, so nothing was sent.' : 'None of the people ticked have opted in to texts, so nothing was sent.' };
  const res = await sendMany(active, (t) =>
    sendSms({ db: supabase, to: t.mobile, body: text.replace(/\{first\}/g, t.first_name).replace(/\{link\}/g, `${appUrl()}/me/${t.reg_token}`), kind: 'bulk', tempId: t.id, sentBy: profile.id }),
  );
  await audit(supabase, profile.id, 'sms.pool', `Texted ${res.sent} in the ${p.client} (${p.site}) pool for ${date}${busy ? ` (${busy} skipped: already working that day)` : ''}: "${text.slice(0, 60)}${text.length > 60 ? '...' : ''}"`);
  const extra = [busy ? `${busy} not sent: already have a shift that day` : '', res.failed ? `${res.failed} failed` : '', res.off ? `${res.off} not sent: messages switched off` : '', notIn ? `${notIn} not sent: not opted in to texts` : ''].filter(Boolean);
  return { ok: true, message: `Sent to ${res.sent} ${res.sent === 1 ? 'person' : 'people'}${extra.length ? `. ${extra.join('. ')}` : ''}.` };
}

/** Admins: delete a pool (e.g. one made by a typo in a shift's client name). Nobody is texted. */
export async function deletePool(poolId: string): Promise<Result> {
  const { supabase, profile } = await requireStaff({ admin: true });
  const { data: p } = await supabase.from('pools').select('client,site').eq('id', poolId).maybeSingle();
  if (!p) return { ok: false, error: 'Not found.' };
  await supabase.from('pools').delete().eq('id', poolId);
  await audit(supabase, profile.id, 'pool.deleted', `Deleted the ${p.client} (${p.site}) pool`);
  revalidatePath('/pools');
  return { ok: true };
}

/**
 * Office change to one day of someone's week (after a call, or for someone who hasn't replied). Always wins over
 * what they ticked: turning a day on adds it (or undoes an earlier take-off); turning it off takes it off.
 */
export async function setWeekDay(poolId: string, tempId: string, week: string, day: number, on: boolean): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || !Number.isInteger(day) || day < 1 || day > 7) return { ok: false, error: 'Not a valid day.' };
  const { data: m } = await supabase.from('pool_members').select('id').eq('pool_id', poolId).eq('temp_id', tempId).maybeSingle();
  if (!m) return { ok: false, error: 'They’re not in this pool any more. Refresh the page.' };
  const { data: row } = await supabase.from('pool_week').select('worker_days,office_on,office_off').eq('pool_id', poolId).eq('temp_id', tempId).eq('week_start', week).maybeSingle();
  const worker = new Set<number>((row?.worker_days as number[]) ?? []);
  const plus = new Set<number>((row?.office_on as number[]) ?? []);
  const minus = new Set<number>((row?.office_off as number[]) ?? []);
  if (on) { minus.delete(day); if (!worker.has(day)) plus.add(day); }
  else { plus.delete(day); if (worker.has(day)) minus.add(day); }
  const now = new Date().toISOString();
  const { error } = await supabase.from('pool_week').upsert({
    pool_id: poolId, temp_id: tempId, week_start: week, worker_days: [...worker].sort(), office_on: [...plus].sort(), office_off: [...minus].sort(),
    office_by: profile.id, office_at: now, updated_at: now,
  }, { onConflict: 'pool_id,temp_id,week_start' });
  if (error) return { ok: false, error: 'Couldn’t save. Has supabase/2026-11-26-weekly-availability-and-reg-notes.sql been run in Supabase?' };
  return { ok: true };
}

/** Admins: send the weekly availability text now (it also goes automatically every Friday 8am). Nobody is asked twice. */
export async function askAvailabilityNow(): Promise<Result> {
  const { supabase, profile } = await requireStaff({ admin: true });
  const week = nextWeek();
  const r = await askForWeek(createAdminClient(), week, profile.id);
  await audit(supabase, profile.id, 'pool.availability_texts', `Sent the weekly availability text (${weekLabel(week)}) to ${r.sent}${r.failed ? ` (${r.failed} failed)` : ''}`);
  revalidatePath('/pools');
  return r.sent || r.failed
    ? { ok: true, message: `Asked ${r.sent} ${r.sent === 1 ? 'person' : 'people'} about ${weekLabel(week)}${r.failed ? `. ${r.failed} failed` : ''}.` }
    : { ok: true, message: `Everyone in a pool who can be texted has already been asked about ${weekLabel(week)}.` };
}

/** Merge this pool into another (same site entered two ways). Everyone moves across with their days and weekly answers. */
export async function mergePool(fromId: string, intoId: string): Promise<Result & { into?: string }> {
  const { supabase, profile } = await requireStaff();
  const [{ data: a }, { data: b }] = await Promise.all([
    supabase.from('pools').select('client,site,site_postcode').eq('id', fromId).maybeSingle(),
    supabase.from('pools').select('client,site,site_postcode').eq('id', intoId).maybeSingle(),
  ]);
  if (!a || !b) return { ok: false, error: 'Pool not found. Refresh the page.' };
  const { data, error } = await supabase.rpc('merge_pools', { p_from: fromId, p_into: intoId });
  if (error) return { ok: false, error: /function|does not exist/i.test(error.message) ? 'Run supabase/2026-11-27-merge-pools.sql in Supabase first.' : error.message };
  const r = data as { moved: number; joined: number };
  await audit(supabase, profile.id, 'pool.merged', `Merged the ${a.client} ${a.site} (${a.site_postcode}) pool into ${b.client} ${b.site} (${b.site_postcode}): ${r.moved} moved, ${r.joined} already in both`);
  revalidatePath('/pools'); revalidatePath(`/pools/${intoId}`);
  return { ok: true, into: intoId, message: `Merged. ${r.moved} moved across${r.joined ? `, ${r.joined} were already in both (their days are combined)` : ''}.` };
}
