'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireStaff, audit } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { geocodePostcode, looksLikePostcode, milesBetween, normalisePostcode } from '@/lib/geo';
import { sendMany, sendToTemp } from '@/lib/sms';
import { offerText, offerWa, promotedText, promotedWa, noShowText, replyAccepted } from '@/lib/texts';
import { displayMobile } from '@/lib/phone';
import { shiftWhen, JOB_TYPES, PPE_OPTIONS } from '@/lib/format';
import { bookingsNear, overlaps } from '@/lib/clash';

export type ShiftInput = {
  client: string; site: string; sitePostcode: string; date: string; start: string; end: string;
  jobType: string; duties: string; pay: number; heads: number; radius: number; ppe: string[];
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
