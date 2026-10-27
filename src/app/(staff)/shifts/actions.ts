'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireStaff, audit } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { geocodePostcode, looksLikePostcode, milesBetween, normalisePostcode } from '@/lib/geo';
import { sendMany, sendToTemp } from '@/lib/sms';
import { offerText, offerWa, promotedText, promotedWa, noShowText, replyAccepted, appUrl, seriesOfferText, seriesBookedText } from '@/lib/texts';
import { displayMobile } from '@/lib/phone';
import { shiftWhen, JOB_TYPES, PPE_OPTIONS } from '@/lib/format';
import { bookingsNear, overlaps } from '@/lib/clash';
import { seriesWhen, dayLabel } from '@/lib/series';
import { randomUUID } from 'crypto';

export type ShiftInput = {
  client: string; site: string; sitePostcode: string; date: string; start: string; end: string;
  jobType: string; duties: string; pay: number; heads: number; radius: number; ppe: string[];
  /** Several days: one offer covers them all and temps say which days they can do. */
  dates?: string[];
};

type Temp = { id: string; first_name: string; mobile: string; lat: number | null; lng: number | null; job_types: string[] };

async function matchTemps(supabase: Awaited<ReturnType<typeof requireStaff>>['supabase'], point: { lat: number; lng: number }, jobType: string, radius: number) {
  const { data } = await supabase.from('temps').select('id,first_name,mobile,lat,lng,job_types').eq('status', 'active').contains('job_types', [jobType]);
  return ((data ?? []) as Temp[])
    .filter((t) => t.lat != null && t.lng != null)
    .map((t) => ({ ...t, miles: milesBetween(point, { lat: t.lat!, lng: t.lng! }) }))
    .filter((t) => t.miles <= radius)
    .sort((a, b) => a.miles - b.miles);
}

/** How many temps a shift would go to, before sending. */
export async function previewReach(sitePostcode: string, jobType: string, radius: number) {
  const { supabase } = await requireStaff();
  if (!looksLikePostcode(sitePostcode)) return { ok: false as const, error: 'Enter the site’s full postcode to see who it goes to.' };
  const point = await geocodePostcode(sitePostcode);
  if (!point) return { ok: false as const, error: 'Site postcode not found.' };
  const list = await matchTemps(supabase, point, jobType, radius);
  return { ok: true as const, count: list.length };
}

export async function createAndSendShift(input: ShiftInput): Promise<{ ok: false; error: string } | never> {
  const { supabase, profile } = await requireStaff();
  const problems: string[] = [];
  if (!input.client.trim()) problems.push('client');
  if (!input.site.trim()) problems.push('site address');
  if (!looksLikePostcode(input.sitePostcode)) problems.push('site postcode');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) problems.push('date');
  if (!/^\d{2}:\d{2}$/.test(input.start) || !/^\d{2}:\d{2}$/.test(input.end)) problems.push('start and finish times');
  if (!(JOB_TYPES as readonly string[]).includes(input.jobType)) problems.push('job type');
  if (!(input.pay > 0)) problems.push('pay rate');
  if (!(input.heads >= 1 && input.heads <= 200)) problems.push('heads needed (1 to 200)');
  if (!(input.radius > 0 && input.radius <= 100)) problems.push('radius (1 to 100 miles)');
  if (problems.length) return { ok: false, error: 'Check the ' + problems.join(', ') + '.' };
  if (input.date < new Date().toISOString().slice(0, 10)) return { ok: false, error: 'That date is in the past.' };
  const dates = [...new Set((input.dates ?? []).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)))].sort();
  if (dates.length > 1) return createSeries(supabase, profile, input, dates);

  const pc = normalisePostcode(input.sitePostcode);
  const point = await geocodePostcode(pc);
  if (!point) return { ok: false, error: `We couldn’t find the postcode ${pc}.` };

  const { data: shift, error } = await supabase
    .from('shifts')
    .insert({
      client: input.client.trim(), site: input.site.trim(), site_postcode: pc, lat: point.lat, lng: point.lng,
      shift_date: input.date, start_time: input.start, end_time: input.end, job_type: input.jobType,
      duties: input.duties.split('\n').map((s) => s.trim()).filter(Boolean),
      pay_rate: Math.round(input.pay * 100) / 100, heads: Math.round(input.heads), radius_miles: input.radius,
      ppe: input.ppe.filter((p) => (PPE_OPTIONS as readonly string[]).includes(p)), sent_by: profile.id,
    })
    .select()
    .single();
  if (error || !shift) return { ok: false, error: 'Couldn’t save the shift. Try again.' };

  const matched = await matchTemps(supabase, point, input.jobType, input.radius);
  // Skip anyone already booked on a shift at the same time.
  const booked = await bookingsNear(supabase, matched.map((t) => t.id), shift.shift_date);
  const temps = matched.filter((t) => !(booked.get(t.id) ?? []).some((b) => overlaps(b, shift)));
  const busy = matched.length - temps.length;
  let sent = 0, failed = 0;
  if (temps.length) {
    const { data: offers } = await supabase
      .from('offers')
      .insert(temps.map((t) => ({ shift_id: shift.id, temp_id: t.id, distance_miles: Math.round(t.miles * 10) / 10 })))
      .select('id,temp_id,token');
    const byTemp = new Map(temps.map((t) => [t.id, t]));
    const res = await sendMany(offers ?? [], (o) => {
      const t = byTemp.get(o.temp_id)!;
      const info = { first: t.first_name, client: shift.client, when: shiftWhen(shift), site: `${shift.site}, ${shift.site_postcode}`, pay: Number(shift.pay_rate), duties: shift.duties ?? [], ppe: shift.ppe ?? [], token: o.token };
      return sendToTemp({ db: supabase, temp: t, kind: 'offer', offerId: o.id, sentBy: profile.id, body: offerText(info), wa: { template: 'offer', vars: offerWa(info) } });
    });
    sent = res.sent; failed = res.failed;
  }
  await audit(supabase, profile.id, 'shift.sent', `Sent ${shift.client} shift (${shiftWhen(shift)}, ${shift.heads} needed) to ${sent} temps${failed ? `, ${failed} texts failed` : ''}${busy ? `. ${busy} already booked at that time were skipped` : ''}`);
  revalidatePath('/shifts');
  redirect(`/shifts/${shift.id}?sent=${sent}&failed=${failed}&busy=${busy}`);
}

export async function noShow(offerId: string) {
  const { supabase, profile } = await requireStaff();
  const { data: o } = await supabase.from('offers').select('id,shift_id,temp_id,temps(first_name,last_name,mobile,status),shifts(client,shift_date,start_time,end_time)').eq('id', offerId).single();
  const { data: promotedId, error } = await supabase.rpc('mark_no_show', { p_offer_id: offerId });
  if (error || !o) return { ok: false, error: 'Couldn’t mark this no-show. Refresh and try again.' };
  const t = o.temps as unknown as { first_name: string; last_name: string; mobile: string; status: string };
  const sh = o.shifts as unknown as { client: string; shift_date: string; start_time: string; end_time: string };
  let detail = `Marked ${t.first_name} ${t.last_name} as no-show`;
  // Let the temp know, in case they did attend but weren't recorded (e.g. didn't clock in).
  if (t.status !== 'out') {
    const r = await sendToTemp({ db: supabase, temp: { id: o.temp_id, mobile: t.mobile }, kind: 'system', offerId, sentBy: profile.id, body: noShowText(t.first_name, sh.client, shiftWhen(sh)) });
    detail += r.ok ? ' and texted them' : ' (text to them failed)';
  }
  if (promotedId) {
    const { data: p } = await supabase.from('offers').select('token,temp_id,temps(first_name,last_name,mobile),shifts(client,shift_date,start_time,end_time)').eq('id', promotedId).single();
    if (p) {
      const pt = p.temps as unknown as { first_name: string; last_name: string; mobile: string };
      const ps = p.shifts as unknown as { client: string; shift_date: string; start_time: string; end_time: string };
      const info = { first: pt.first_name, client: ps.client, when: shiftWhen(ps), token: p.token };
      await sendToTemp({ db: supabase, temp: { id: p.temp_id, mobile: pt.mobile }, kind: 'promoted', offerId: promotedId, sentBy: profile.id, body: promotedText(info), wa: { template: 'promoted', vars: promotedWa(info) } });
      detail += `. ${pt.first_name} ${pt.last_name} promoted from standby and texted`;
    }
  } else detail += '. Nobody on standby, slot reopened';
  await audit(supabase, profile.id, 'shift.noshow', detail);
  revalidatePath(`/shifts/${o.shift_id}`);
  return { ok: true };
}

export async function cancelShift(shiftId: string) {
  const { supabase, profile } = await requireStaff();
  const { data: s } = await supabase.from('shifts').select('*').eq('id', shiftId).single();
  if (!s || s.status === 'cancelled') return { ok: false, error: 'Shift not found or already cancelled.' };
  await supabase.from('shifts').update({ status: 'cancelled' }).eq('id', shiftId);
  const { data: booked } = await supabase.from('offers').select('temp_id,temps(first_name,mobile)').eq('shift_id', shiftId).in('status', ['accepted', 'standby']);
  const res = await sendMany(booked ?? [], (b) => {
    const t = b.temps as unknown as { first_name: string; mobile: string };
    return sendToTemp({ db: supabase, temp: { id: b.temp_id, mobile: t.mobile }, kind: 'system', sentBy: profile.id, body: `Hi ${t.first_name}, sorry, the ${s.client} shift on ${shiftWhen(s)} has been cancelled by the client. You don't need to attend. - Staff Selection` });
  });
  await audit(supabase, profile.id, 'shift.cancelled', `Cancelled ${s.client} shift (${shiftWhen(s)}). ${res.sent} booked temps texted`);
  revalidatePath(`/shifts/${shiftId}`);
  revalidatePath('/shifts');
  return { ok: true };
}

/**
 * Admins can delete a shift that nobody worked: cancelled shifts, and shifts with no one booked or marked no-show
 * (test shifts, mistakes). Shifts people actually worked are kept as a record (pay, holiday, 12-week rule).
 */
export async function deleteShift(shiftId: string) {
  const { supabase, profile } = await requireStaff({ admin: true });
  const { data: s } = await supabase.from('shifts').select('id,client,shift_date,start_time,end_time,status,offers(status)').eq('id', shiftId).maybeSingle();
  if (!s) return { ok: false, error: 'Shift not found.' };
  const worked = ((s.offers ?? []) as { status: string }[]).some((o) => o.status === 'accepted' || o.status === 'noshow');
  if (worked && s.status !== 'cancelled') return { ok: false, error: 'Someone was booked on this shift, so it’s kept as a record. Cancel it first if it didn’t go ahead.' };
  const { error } = await createAdminClient().from('shifts').delete().eq('id', shiftId);
  if (error) return { ok: false, error: 'Couldn’t delete. Try again.' };
  await audit(supabase, profile.id, 'shift.deleted', `Deleted ${s.client} shift (${shiftWhen(s)})`);
  revalidatePath('/shifts');
  return { ok: true };
}

/**
 * Takes a booked temp off a shift without recording a no-show (double booking, change of plan, client request).
 * The first person on standby who's free at that time is moved up and texted; otherwise the place reopens.
 */
export async function removeFromShift(offerId: string) {
  const { supabase, profile } = await requireStaff();
  const db = createAdminClient();
  const { data: o } = await db.from('offers').select('id,status,shift_id,temp_id,temps(first_name,last_name,mobile,status),shifts(id,client,shift_date,start_time,end_time,status)').eq('id', offerId).maybeSingle();
  if (!o || o.status !== 'accepted') return { ok: false, error: 'They’re not booked on this shift any more. Refresh the page.' };
  const t = o.temps as unknown as { first_name: string; last_name: string; mobile: string; status: string };
  const s = o.shifts as unknown as { id: string; client: string; shift_date: string; start_time: string; end_time: string; status: string };
  await db.from('offers').update({ status: 'declined', decline_reason: 'Removed by office', standby_at: null }).eq('id', offerId);
  let detail = `Took ${t.first_name} ${t.last_name} off ${s.client} (${shiftWhen(s)})`;
  if (t.status !== 'out') await sendToTemp({ db, temp: { id: o.temp_id, mobile: t.mobile }, kind: 'system', offerId, sentBy: profile.id, body: `Hi ${t.first_name}, you've been taken off the ${s.client} shift on ${shiftWhen(s)}. You don't need to attend. Call the office if you have any questions. - Staff Selection` });

  // Move up the first person on standby who isn't booked elsewhere at that time.
  const { data: standby } = await db.from('offers').select('id,temp_id,token,temps(first_name,last_name,mobile)').eq('shift_id', s.id).eq('status', 'standby').order('standby_at');
  const booked = await bookingsNear(db, (standby ?? []).map((x) => x.temp_id), s.shift_date);
  const next = (standby ?? []).find((x) => !(booked.get(x.temp_id) ?? []).some((b) => b.id !== s.id && overlaps(b, s)));
  if (next && s.status !== 'cancelled') {
    await db.from('offers').update({ status: 'accepted', responded_at: new Date().toISOString(), standby_at: null }).eq('id', next.id);
    const pt = next.temps as unknown as { first_name: string; last_name: string; mobile: string };
    const info = { first: pt.first_name, client: s.client, when: shiftWhen(s), token: next.token };
    await sendToTemp({ db, temp: { id: next.temp_id, mobile: pt.mobile }, kind: 'promoted', offerId: next.id, sentBy: profile.id, body: promotedText(info), wa: { template: 'promoted', vars: promotedWa(info) } });
    detail += `. ${pt.first_name} ${pt.last_name} moved up from standby and texted`;
  } else if (s.status === 'filled') {
    await db.from('shifts').update({ status: 'open' }).eq('id', s.id);
    detail += '. Place reopened';
  }
  await audit(supabase, profile.id, 'shift.removed', detail);
  revalidatePath(`/shifts/${s.id}`);
  return { ok: true };
}

/** Temps who'd be new for this shift: matching, within the radius, not sent it before, and not booked elsewhere at that time. */
async function newTempsFor(supabase: Awaited<ReturnType<typeof requireStaff>>['supabase'], shiftId: string, radius: number) {
  const { data: s } = await supabase.from('shifts').select('*').eq('id', shiftId).maybeSingle();
  if (!s || s.lat == null || s.lng == null) return { s: null, temps: [] as (Temp & { miles: number })[], busy: 0 };
  const matched = await matchTemps(supabase, { lat: s.lat, lng: s.lng }, s.job_type, radius);
  const { data: already } = await supabase.from('offers').select('temp_id').eq('shift_id', shiftId);
  const sent = new Set((already ?? []).map((o) => o.temp_id));
  const fresh = matched.filter((t) => !sent.has(t.id));
  const booked = await bookingsNear(supabase, fresh.map((t) => t.id), s.shift_date);
  const temps = fresh.filter((t) => !(booked.get(t.id) ?? []).some((b) => overlaps(b, s)));
  return { s, temps, busy: fresh.length - temps.length };
}

export async function previewMore(shiftId: string, radius: number) {
  const { supabase } = await requireStaff();
  if (!(radius > 0 && radius <= 100)) return { ok: false as const, error: 'Radius must be 1 to 100 miles.' };
  const { s, temps, busy } = await newTempsFor(supabase, shiftId, radius);
  if (!s) return { ok: false as const, error: 'Shift not found.' };
  return { ok: true as const, count: temps.length, busy };
}

/** Sends an open shift to temps who haven't had it yet (e.g. newly added temps, or a wider radius). Nobody gets it twice. */
export async function sendToMore(shiftId: string, radius: number) {
  const { supabase, profile } = await requireStaff();
  if (!(radius > 0 && radius <= 100)) return { ok: false, error: 'Radius must be 1 to 100 miles.' };
  const { s, temps, busy } = await newTempsFor(supabase, shiftId, radius);
  if (!s) return { ok: false, error: 'Shift not found.' };
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  if (s.status === 'cancelled' || s.shift_date < today) return { ok: false, error: 'This shift is cancelled or has passed.' };
  if (!temps.length) return { ok: false, error: 'There’s nobody new to send it to. Try a bigger radius, or add more temps.' };
  const { data: offers } = await supabase
    .from('offers')
    .upsert(temps.map((t) => ({ shift_id: s.id, temp_id: t.id, distance_miles: Math.round(t.miles * 10) / 10 })), { onConflict: 'shift_id,temp_id', ignoreDuplicates: true })
    .select('id,temp_id,token');
  const byTemp = new Map(temps.map((t) => [t.id, t]));
  const res = await sendMany(offers ?? [], (o) => {
    const t = byTemp.get(o.temp_id)!;
    const info = { first: t.first_name, client: s.client, when: shiftWhen(s), site: `${s.site}, ${s.site_postcode}`, pay: Number(s.pay_rate), duties: s.duties ?? [], ppe: s.ppe ?? [], token: o.token };
    return sendToTemp({ db: supabase, temp: t, kind: 'offer', offerId: o.id, sentBy: profile.id, body: offerText(info), wa: { template: 'offer', vars: offerWa(info) } });
  });
  if (radius > Number(s.radius_miles)) await supabase.from('shifts').update({ radius_miles: radius }).eq('id', s.id);
  await audit(supabase, profile.id, 'shift.sent_more', `Sent ${s.client} shift (${shiftWhen(s)}) to ${res.sent} more temps${res.failed ? `, ${res.failed} failed` : ''}${radius > Number(s.radius_miles) ? `, radius now ${radius} mi` : ''}`);
  revalidatePath(`/shifts/${s.id}`);
  return { ok: true, message: `Sent to ${res.sent} more temp${res.sent === 1 ? '' : 's'}${res.failed ? ` (${res.failed} failed)` : ''}${busy ? `. ${busy} already booked at that time were skipped` : ''}.` };
}

/** Finds active temps by name or mobile to book onto a shift by hand. */
export async function findTempsForShift(shiftId: string, q: string) {
  const { supabase } = await requireStaff();
  const query = q.trim();
  if (query.length < 2) return [];
  const digits = query.replace(/\D/g, '');
  const { data: temps } = await supabase.from('temps').select('id,first_name,last_name,mobile,postcode,status').in('status', ['active', 'hold', 'pending']).limit(2000);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = (temps ?? []).filter((t) => {
    const name = `${t.first_name} ${t.last_name}`.toLowerCase();
    const mob = displayMobile(t.mobile).replace(/\D/g, '');
    return (digits.length >= 4 && mob.includes(digits.replace(/^44/, '0'))) || (words.length && words.every((w) => name.includes(w)));
  }).slice(0, 8);
  const { data: s } = await supabase.from('shifts').select('id,shift_date,start_time,end_time').eq('id', shiftId).maybeSingle();
  const { data: mine } = await supabase.from('offers').select('temp_id,status').eq('shift_id', shiftId).in('temp_id', hits.map((h) => h.id));
  const booked = s ? await bookingsNear(supabase, hits.map((h) => h.id), s.shift_date) : new Map();
  return hits.map((t) => ({
    id: t.id, name: `${t.first_name} ${t.last_name}`, mobile: displayMobile(t.mobile), postcode: t.postcode, status: t.status,
    onShift: (mine ?? []).some((o) => o.temp_id === t.id && o.status === 'accepted'),
    clash: s ? (booked.get(t.id) ?? []).some((b: { id: string }) => b.id !== s.id && overlaps(b as never, s)) : false,
  }));
}

/** Books a temp onto a shift by hand, e.g. they rang or texted the office to confirm. */
export async function addToShift(shiftId: string, tempId: string, textThem: boolean) {
  const { supabase, profile } = await requireStaff();
  const { data: s } = await supabase.from('shifts').select('*').eq('id', shiftId).maybeSingle();
  const { data: t } = await supabase.from('temps').select('id,first_name,last_name,mobile,status,registered_at,bank_on_file,reg_token').eq('id', tempId).maybeSingle();
  if (!s || !t) return { ok: false, error: 'Not found. Refresh the page.' };
  if (s.status === 'cancelled') return { ok: false, error: 'This shift is cancelled.' };
  if (t.status !== 'active') return { ok: false, error: `${t.first_name} isn’t active (${t.status === 'hold' ? 'on hold' : 'hasn’t opted in yet'}), so can’t be booked.` };
  const { count } = await supabase.from('offers').select('id', { count: 'exact', head: true }).eq('shift_id', s.id).eq('status', 'accepted');
  if ((count ?? 0) >= s.heads) return { ok: false, error: 'This shift is already full. Take someone off first, or increase the heads.' };
  const clash = (await bookingsNear(supabase, [t.id], s.shift_date)).get(t.id)?.find((b) => b.id !== s.id && overlaps(b, s));
  if (clash) return { ok: false, error: `${t.first_name} is already booked on ${clash.client} at that time.` };
  const now = new Date().toISOString();
  const { data: o, error } = await supabase.from('offers')
    .upsert({ shift_id: s.id, temp_id: t.id, status: 'accepted', responded_at: now, standby_at: null, decline_reason: null }, { onConflict: 'shift_id,temp_id' })
    .select('id').single();
  if (error || !o) return { ok: false, error: 'Couldn’t book them on. Try again.' };
  if ((count ?? 0) + 1 >= s.heads) await supabase.from('shifts').update({ status: 'filled' }).eq('id', s.id);
  if (textThem) await sendToTemp({ db: supabase, temp: t, kind: 'system', offerId: o.id, sentBy: profile.id, body: replyAccepted(s.client, shiftWhen(s), `${s.site}, ${s.site_postcode}`, t.registered_at && !t.bank_on_file ? t.reg_token : null) });
  await audit(supabase, profile.id, 'shift.added_manually', `Booked ${t.first_name} ${t.last_name} onto ${s.client} (${shiftWhen(s)}) by hand${textThem ? ' and texted them' : ''}`);
  revalidatePath(`/shifts/${s.id}`);
  return { ok: true, message: `${t.first_name} is booked on${textThem ? ' and has been texted' : ''}.` };
}

export type ShiftEdit = { heads: number; pay: number; start: string; end: string; duties: string; ppe: string[]; notify: boolean };

/**
 * Edits an existing shift: number of people needed, pay, times, duties and PPE.
 * Extra places are offered to standby first (in order, if they're free); booked temps can be texted about changes.
 */
export async function updateShift(shiftId: string, e: ShiftEdit) {
  const { supabase, profile } = await requireStaff();
  const { data: s } = await supabase.from('shifts').select('*').eq('id', shiftId).maybeSingle();
  if (!s) return { ok: false, error: 'Shift not found.' };
  if (s.status === 'cancelled') return { ok: false, error: 'This shift is cancelled.' };
  const heads = Math.round(e.heads), pay = Math.round(e.pay * 100) / 100;
  if (!(heads >= 1 && heads <= 200)) return { ok: false, error: 'People needed must be 1 to 200.' };
  if (!(pay > 0)) return { ok: false, error: 'Enter the pay rate.' };
  if (!/^\d{2}:\d{2}$/.test(e.start) || !/^\d{2}:\d{2}$/.test(e.end)) return { ok: false, error: 'Check the start and finish times.' };
  const { data: offers } = await supabase.from('offers').select('id,temp_id,status,token,standby_at,temps(first_name,mobile,status)').eq('shift_id', s.id);
  const booked = (offers ?? []).filter((o) => o.status === 'accepted');
  if (heads < booked.length) return { ok: false, error: `${booked.length} people are already booked. Take someone off first, or keep it at ${booked.length} or more.` };

  const ppe = e.ppe.filter((x) => (PPE_OPTIONS as readonly string[]).includes(x));
  const duties = e.duties.split('\n').map((x) => x.trim()).filter(Boolean);
  const changes: string[] = [];
  if (heads !== s.heads) changes.push(`people needed ${s.heads} → ${heads}`);
  if (pay !== Number(s.pay_rate)) changes.push(`pay £${Number(s.pay_rate).toFixed(2)} → £${pay.toFixed(2)}`);
  if (e.start !== s.start_time.slice(0, 5) || e.end !== s.end_time.slice(0, 5)) changes.push(`times ${s.start_time.slice(0, 5)}-${s.end_time.slice(0, 5)} → ${e.start}-${e.end}`);
  if (JSON.stringify(duties) !== JSON.stringify(s.duties ?? [])) changes.push('duties');
  if (JSON.stringify([...ppe].sort()) !== JSON.stringify([...(s.ppe ?? [])].sort())) changes.push('PPE');
  if (!changes.length) return { ok: false, error: 'Nothing has changed.' };

  const updated = { ...s, heads, pay_rate: pay, start_time: e.start, end_time: e.end, duties, ppe };
  await supabase.from('shifts').update({ heads, pay_rate: pay, start_time: e.start, end_time: e.end, duties, ppe, status: booked.length >= heads ? 'filled' : 'open' }).eq('id', s.id);

  // Fill any new places from standby, in the order people joined it, skipping anyone now booked elsewhere at that time.
  let promoted = 0;
  const free = heads - booked.length;
  if (free > 0) {
    const standby = (offers ?? []).filter((o) => o.status === 'standby').sort((a, b) => (a.standby_at ?? '').localeCompare(b.standby_at ?? ''));
    const busy = await bookingsNear(supabase, standby.map((o) => o.temp_id), updated.shift_date);
    for (const o of standby) {
      if (promoted >= free) break;
      if ((busy.get(o.temp_id) ?? []).some((b) => b.id !== s.id && overlaps(b, updated))) continue;
      await supabase.from('offers').update({ status: 'accepted', responded_at: new Date().toISOString(), standby_at: null }).eq('id', o.id);
      const t = o.temps as unknown as { first_name: string; mobile: string };
      const info = { first: t.first_name, client: s.client, when: shiftWhen(updated), token: o.token };
      await sendToTemp({ db: supabase, temp: { id: o.temp_id, mobile: t.mobile }, kind: 'promoted', offerId: o.id, sentBy: profile.id, body: promotedText(info), wa: { template: 'promoted', vars: promotedWa(info) } });
      promoted++;
    }
    if (booked.length + promoted >= heads) await supabase.from('shifts').update({ status: 'filled' }).eq('id', s.id);
  }

  // Tell booked temps about changes that affect them (not just the number of people needed).
  let told = 0;
  const affecting = changes.filter((c) => !c.startsWith('people needed'));
  if (e.notify && affecting.length) {
    const res = await sendMany(booked, (o) => {
      const t = o.temps as unknown as { first_name: string; mobile: string; status: string };
      return sendToTemp({ db: supabase, temp: { id: o.temp_id, mobile: t.mobile }, kind: 'system', offerId: o.id, sentBy: profile.id,
        body: `Hi ${t.first_name}, your ${s.client} shift has changed. It's now ${shiftWhen(updated)}, £${pay.toFixed(2)}/hr${ppe.length ? `. Bring: ${ppe.join(', ').toLowerCase()}` : ''}. Details: ${appUrl()}/s/${o.token} - Staff Selection` });
    });
    told = res.sent;
  }
  await audit(supabase, profile.id, 'shift.edited', `Edited ${s.client} shift (${shiftWhen(updated)}): ${changes.join(', ')}${promoted ? `. ${promoted} moved up from standby` : ''}${told ? `. ${told} booked temps texted` : ''}`);
  revalidatePath(`/shifts/${s.id}`);
  revalidatePath('/shifts');
  return { ok: true, message: `Saved.${promoted ? ` ${promoted} moved up from standby and texted.` : ''}${told ? ` ${told} booked temp${told === 1 ? '' : 's'} texted about the change.` : ''}${free - promoted > 0 ? ` ${free - promoted} place${free - promoted === 1 ? '' : 's'} still to fill: use Send to more temps or Add someone by hand.` : ''}` };
}

type Db = Awaited<ReturnType<typeof requireStaff>>['supabase'];
type Me = Awaited<ReturnType<typeof requireStaff>>['profile'];
type DayRow = { id: string; shift_date: string; start_time: string; end_time: string; client: string; site: string; site_postcode: string; pay_rate: number; ppe: string[] | null; duties: string[] | null; [k: string]: unknown };

/** Sends one message per temp covering every day of a weekly shift they're free for. Returns how many were sent. */
async function offerSeries(supabase: Db, profile: Me, days: DayRow[], temps: (Temp & { miles: number })[]) {
  const booked = await bookingsNear(supabase, temps.map((t) => t.id), days[0].shift_date);
  for (const day of days.slice(1)) {
    const more = await bookingsNear(supabase, temps.map((t) => t.id), day.shift_date);
    more.forEach((v, k) => booked.set(k, [...(booked.get(k) ?? []), ...v]));
  }
  const rows = temps.flatMap((t) => days
    .filter((day) => !(booked.get(t.id) ?? []).some((b) => b.id !== day.id && overlaps(b, day)))
    .map((day) => ({ shift_id: day.id, temp_id: t.id, distance_miles: Math.round(t.miles * 10) / 10 })));
  if (!rows.length) return { sent: 0, failed: 0, people: 0 };
  const { data: offers } = await supabase.from('offers').upsert(rows, { onConflict: 'shift_id,temp_id', ignoreDuplicates: true }).select('id,temp_id,token,shift_id');
  const dateOf = new Map(days.map((x) => [x.id, x.shift_date]));
  const firstByTemp = new Map<string, { id: string; token: string; temp_id: string; days: string[] }>();
  for (const o of (offers ?? []).sort((a, b) => (dateOf.get(a.shift_id) ?? '').localeCompare(dateOf.get(b.shift_id) ?? ''))) {
    const cur = firstByTemp.get(o.temp_id);
    if (cur) cur.days.push(o.shift_id); else firstByTemp.set(o.temp_id, { id: o.id, token: o.token, temp_id: o.temp_id, days: [o.shift_id] });
  }
  const byTemp = new Map(temps.map((t) => [t.id, t]));
  const s0 = days[0];
  const res = await sendMany([...firstByTemp.values()], (o) => {
    const t = byTemp.get(o.temp_id)!;
    const theirDays = days.filter((x) => o.days.includes(x.id));
    const when = seriesWhen(theirDays);
    const info = { first: t.first_name, client: s0.client, when, pay: Number(s0.pay_rate), ppe: s0.ppe ?? [], token: o.token };
    const wa = offerWa({ ...info, site: `${s0.site}, ${s0.site_postcode}`, duties: s0.duties ?? [] });
    return sendToTemp({ db: supabase, temp: t, kind: 'offer', offerId: o.id, sentBy: profile.id, body: seriesOfferText(info), wa: { template: 'offer', vars: wa } });
  });
  return { ...res, people: firstByTemp.size };
}

async function createSeries(supabase: Db, profile: Me, input: ShiftInput, dates: string[]): Promise<{ ok: false; error: string } | never> {
  if (dates.length > 14) return { ok: false, error: 'Choose up to 14 days.' };
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  if (dates[0] < today) return { ok: false, error: 'One of the days is in the past.' };
  const pc = normalisePostcode(input.sitePostcode);
  const point = await geocodePostcode(pc);
  if (!point) return { ok: false, error: `We couldn’t find the postcode ${pc}.` };
  const seriesId = randomUUID();
  const base = {
    client: input.client.trim(), site: input.site.trim(), site_postcode: pc, lat: point.lat, lng: point.lng,
    start_time: input.start, end_time: input.end, job_type: input.jobType,
    duties: input.duties.split('\n').map((s) => s.trim()).filter(Boolean),
    pay_rate: Math.round(input.pay * 100) / 100, heads: Math.round(input.heads), radius_miles: input.radius,
    ppe: input.ppe.filter((p) => (PPE_OPTIONS as readonly string[]).includes(p)), sent_by: profile.id, series_id: seriesId,
  };
  const { data: days, error } = await supabase.from('shifts').insert(dates.map((shift_date) => ({ ...base, shift_date }))).select().order('shift_date');
  if (error || !days?.length) return { ok: false, error: 'Couldn’t save the shifts. Try again.' };
  const temps = await matchTemps(supabase, point, input.jobType, input.radius);
  const res = await offerSeries(supabase, profile, days, temps);
  await audit(supabase, profile.id, 'shift.sent', `Sent ${base.client} weekly shift (${seriesWhen(days)}, ${base.heads} a day) to ${res.sent} temps${res.failed ? `, ${res.failed} texts failed` : ''}`);
  revalidatePath('/shifts');
  redirect(`/shifts/series/${seriesId}?sent=${res.sent}&failed=${res.failed}`);
}

/** Sends a weekly shift to temps who haven't had it yet. */
export async function seriesSendMore(seriesId: string, radius: number) {
  const { supabase, profile } = await requireStaff();
  if (!(radius > 0 && radius <= 100)) return { ok: false, error: 'Radius must be 1 to 100 miles.' };
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const { data: all } = await supabase.from('shifts').select('*').eq('series_id', seriesId).order('shift_date');
  const days = (all ?? []).filter((d) => d.status !== 'cancelled' && d.shift_date >= today);
  if (!days.length) return { ok: false, error: 'No upcoming days left on this shift.' };
  const matched = await matchTemps(supabase, { lat: days[0].lat, lng: days[0].lng }, days[0].job_type, radius);
  const { data: already } = await supabase.from('offers').select('temp_id').in('shift_id', (all ?? []).map((d) => d.id));
  const had = new Set((already ?? []).map((o) => o.temp_id));
  const fresh = matched.filter((t) => !had.has(t.id));
  if (!fresh.length) return { ok: false, error: 'There’s nobody new to send it to. Try a bigger radius, or add more temps.' };
  const res = await offerSeries(supabase, profile, days, fresh);
  if (radius > Number(days[0].radius_miles)) await supabase.from('shifts').update({ radius_miles: radius }).eq('series_id', seriesId);
  await audit(supabase, profile.id, 'shift.sent_more', `Sent ${days[0].client} weekly shift to ${res.sent} more temps`);
  revalidatePath(`/shifts/series/${seriesId}`);
  return { ok: true, message: `Sent to ${res.sent} more temp${res.sent === 1 ? '' : 's'}${res.failed ? ` (${res.failed} failed)` : ''}.` };
}

export async function seriesPreviewMore(seriesId: string, radius: number) {
  const { supabase } = await requireStaff();
  const { data: all } = await supabase.from('shifts').select('id,lat,lng,job_type').eq('series_id', seriesId);
  if (!all?.length || !(radius > 0)) return 0;
  const matched = await matchTemps(supabase, { lat: all[0].lat, lng: all[0].lng }, all[0].job_type, radius);
  const { data: already } = await supabase.from('offers').select('temp_id').in('shift_id', all.map((d) => d.id));
  const had = new Set((already ?? []).map((o) => o.temp_id));
  return matched.filter((t) => !had.has(t.id)).length;
}

/**
 * Books temps onto the days they said they're available, from the week grid. Each person gets one text listing
 * all the days they've been booked on (cheaper than a text per day).
 */
export async function seriesBook(seriesId: string, offerIds: string[]) {
  const { supabase, profile } = await requireStaff();
  if (!offerIds.length) return { ok: false, error: 'Tick the days you want to book first.' };
  const { data: days } = await supabase.from('shifts').select('*').eq('series_id', seriesId).order('shift_date');
  const dayById = new Map((days ?? []).map((d) => [d.id, d]));
  const { data: offers } = await supabase.from('offers')
    .select('id,shift_id,temp_id,status,temps(first_name,last_name,mobile,status,registered_at,bank_on_file,reg_token)')
    .in('shift_id', [...dayById.keys()]);
  const count = new Map<string, number>();
  for (const o of offers ?? []) if (o.status === 'accepted') count.set(o.shift_id, (count.get(o.shift_id) ?? 0) + 1);
  const chosen = (offers ?? []).filter((o) => offerIds.includes(o.id) && o.status !== 'accepted')
    .sort((a, b) => (dayById.get(a.shift_id)!.shift_date).localeCompare(dayById.get(b.shift_id)!.shift_date));
  const skipped: string[] = [];
  const bookedFor = new Map<string, { t: { first_name: string; last_name: string; mobile: string; registered_at: string | null; bank_on_file: boolean; reg_token: string }; days: string[]; offerId: string }>();
  for (const o of chosen) {
    const d = dayById.get(o.shift_id)!;
    const t = o.temps as unknown as { first_name: string; last_name: string; mobile: string; status: string; registered_at: string | null; bank_on_file: boolean; reg_token: string };
    if (d.status === 'cancelled') { skipped.push(`${dayLabel(d.shift_date)} is cancelled`); continue; }
    if ((count.get(d.id) ?? 0) >= d.heads) { skipped.push(`${dayLabel(d.shift_date)} is full`); continue; }
    if (t.status !== 'active') { skipped.push(`${t.first_name} isn’t active`); continue; }
    const clash = (await bookingsNear(supabase, [o.temp_id], d.shift_date)).get(o.temp_id)?.find((b) => b.id !== d.id && overlaps(b, d));
    if (clash) { skipped.push(`${t.first_name} is booked elsewhere on ${dayLabel(d.shift_date)}`); continue; }
    await supabase.from('offers').update({ status: 'accepted', responded_at: new Date().toISOString(), standby_at: null }).eq('id', o.id);
    count.set(d.id, (count.get(d.id) ?? 0) + 1);
    if ((count.get(d.id) ?? 0) >= d.heads) await supabase.from('shifts').update({ status: 'filled' }).eq('id', d.id);
    const cur = bookedFor.get(o.temp_id) ?? { t, days: [] as string[], offerId: o.id };
    cur.days.push(d.id);
    bookedFor.set(o.temp_id, cur);
  }
  const s0 = days![0];
  const res = await sendMany([...bookedFor.entries()], ([tempId, b]) => {
    const when = seriesWhen((days ?? []).filter((d) => b.days.includes(d.id)));
    return sendToTemp({ db: supabase, temp: { id: tempId, mobile: b.t.mobile }, kind: 'system', offerId: b.offerId, sentBy: profile.id,
      body: seriesBookedText(b.t.first_name, s0.client, when, `${s0.site}, ${s0.site_postcode}`, b.t.registered_at && !b.t.bank_on_file ? b.t.reg_token : null) });
  });
  const people = [...bookedFor.values()];
  await audit(supabase, profile.id, 'shift.series_booked', `Booked ${people.map((p) => `${p.t.first_name} ${p.t.last_name} (${p.days.length} day${p.days.length === 1 ? '' : 's'})`).join(', ') || 'nobody'} on ${s0.client} weekly shift`);
  revalidatePath(`/shifts/series/${seriesId}`);
  return {
    ok: true,
    message: `${people.length} ${people.length === 1 ? 'person' : 'people'} booked and texted${res.failed ? ` (${res.failed} texts failed)` : ''}.${skipped.length ? ` Not booked: ${[...new Set(skipped)].join('; ')}.` : ''}`,
  };
}

/** Cancels every remaining day of a weekly shift. Booked temps get one text listing the days they no longer need to attend. */
export async function seriesCancel(seriesId: string) {
  const { supabase, profile } = await requireStaff();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const { data: days } = await supabase.from('shifts').select('*').eq('series_id', seriesId).order('shift_date');
  const live = (days ?? []).filter((d) => d.status !== 'cancelled' && d.shift_date >= today);
  if (!live.length) return { ok: false, error: 'There are no upcoming days left to cancel.' };
  await supabase.from('shifts').update({ status: 'cancelled' }).in('id', live.map((d) => d.id));
  const { data: booked } = await supabase.from('offers').select('temp_id,shift_id,temps(first_name,mobile,status)').in('shift_id', live.map((d) => d.id)).in('status', ['accepted', 'standby']);
  const byTemp = new Map<string, { t: { first_name: string; mobile: string; status: string }; days: string[] }>();
  for (const b of booked ?? []) {
    const cur = byTemp.get(b.temp_id) ?? { t: b.temps as unknown as { first_name: string; mobile: string; status: string }, days: [] };
    cur.days.push(b.shift_id);
    byTemp.set(b.temp_id, cur);
  }
  const res = await sendMany([...byTemp.entries()].filter(([, v]) => v.t.status !== 'out'), ([tempId, v]) =>
    sendToTemp({ db: supabase, temp: { id: tempId, mobile: v.t.mobile }, kind: 'system', sentBy: profile.id,
      body: `Hi ${v.t.first_name}, sorry, the ${live[0].client} shifts on ${seriesWhen(live.filter((d) => v.days.includes(d.id)))} have been cancelled. You don't need to attend. - Staff Selection` }));
  await audit(supabase, profile.id, 'shift.series_cancelled', `Cancelled ${live[0].client} weekly shift (${seriesWhen(live)}). ${res.sent} temps texted`);
  revalidatePath(`/shifts/series/${seriesId}`);
  revalidatePath('/shifts');
  return { ok: true, message: `Cancelled. ${res.sent} temp${res.sent === 1 ? '' : 's'} texted.` };
}

/** Admins can delete a weekly shift nobody worked (all days cancelled, or no one booked), e.g. a test. */
export async function seriesDelete(seriesId: string) {
  const { supabase, profile } = await requireStaff({ admin: true });
  const { data: days } = await supabase.from('shifts').select('id,client,shift_date,start_time,end_time,status,offers(status)').eq('series_id', seriesId);
  if (!days?.length) return { ok: false, error: 'Not found.' };
  const worked = days.some((d) => d.status !== 'cancelled' && ((d.offers ?? []) as { status: string }[]).some((o) => o.status === 'accepted' || o.status === 'noshow'));
  if (worked) return { ok: false, error: 'People are booked on this week, so it’s kept as a record. Cancel the week first if it didn’t go ahead.' };
  const { error } = await createAdminClient().from('shifts').delete().eq('series_id', seriesId);
  if (error) return { ok: false, error: 'Couldn’t delete. Try again.' };
  await audit(supabase, profile.id, 'shift.series_deleted', `Deleted ${days[0].client} weekly shift (${seriesWhen(days)})`);
  revalidatePath('/shifts');
  return { ok: true };
}
