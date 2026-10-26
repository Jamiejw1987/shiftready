'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireStaff, audit } from '@/lib/auth';
import { geocodePostcode, looksLikePostcode, milesBetween, normalisePostcode } from '@/lib/geo';
import { sendMany, sendSms } from '@/lib/sms';
import { offerText, promotedText } from '@/lib/texts';
import { shiftWhen, JOB_TYPES, PPE_OPTIONS } from '@/lib/format';

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

  const temps = await matchTemps(supabase, point, input.jobType, input.radius);
  let sent = 0, failed = 0;
  if (temps.length) {
    const { data: offers } = await supabase
      .from('offers')
      .insert(temps.map((t) => ({ shift_id: shift.id, temp_id: t.id, distance_miles: Math.round(t.miles * 10) / 10 })))
      .select('id,temp_id,token');
    const byTemp = new Map(temps.map((t) => [t.id, t]));
    const res = await sendMany(
      (offers ?? []).map((o) => ({
        db: supabase, to: byTemp.get(o.temp_id)!.mobile, kind: 'offer', tempId: o.temp_id, sentBy: profile.id,
        body: offerText({ client: shift.client, when: shiftWhen(shift), pay: Number(shift.pay_rate), token: o.token }),
      })),
    );
    sent = res.sent; failed = res.failed;
  }
  await audit(supabase, profile.id, 'shift.sent', `Sent ${shift.client} shift (${shiftWhen(shift)}, ${shift.heads} needed) to ${sent} temps${failed ? `, ${failed} texts failed` : ''}`);
  revalidatePath('/shifts');
  redirect(`/shifts/${shift.id}?sent=${sent}&failed=${failed}`);
}

export async function noShow(offerId: string) {
  const { supabase, profile } = await requireStaff();
  const { data: o } = await supabase.from('offers').select('id,shift_id,temps(first_name,last_name)').eq('id', offerId).single();
  const { data: promotedId, error } = await supabase.rpc('mark_no_show', { p_offer_id: offerId });
  if (error || !o) return { ok: false, error: 'Couldn’t mark this no-show. Refresh and try again.' };
  const t = o.temps as unknown as { first_name: string; last_name: string };
  let detail = `Marked ${t.first_name} ${t.last_name} as no-show`;
  if (promotedId) {
    const { data: p } = await supabase.from('offers').select('token,temp_id,temps(first_name,last_name,mobile),shifts(client,shift_date,start_time,end_time)').eq('id', promotedId).single();
    if (p) {
      const pt = p.temps as unknown as { first_name: string; last_name: string; mobile: string };
      const ps = p.shifts as unknown as { client: string; shift_date: string; start_time: string; end_time: string };
      await sendSms({ db: supabase, to: pt.mobile, kind: 'promoted', tempId: p.temp_id, sentBy: profile.id, body: promotedText({ first: pt.first_name, client: ps.client, when: shiftWhen(ps), token: p.token }) });
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
  const res = await sendMany(
    (booked ?? []).map((b) => {
      const t = b.temps as unknown as { first_name: string; mobile: string };
      return { db: supabase, to: t.mobile, kind: 'system', tempId: b.temp_id, sentBy: profile.id, body: `Hi ${t.first_name}, sorry, the ${s.client} shift on ${shiftWhen(s)} has been cancelled by the client. You don't need to attend. - Staff Selection` };
    }),
  );
  await audit(supabase, profile.id, 'shift.cancelled', `Cancelled ${s.client} shift (${shiftWhen(s)}). ${res.sent} booked temps texted`);
  revalidatePath(`/shifts/${shiftId}`);
  revalidatePath('/shifts');
  return { ok: true };
}
