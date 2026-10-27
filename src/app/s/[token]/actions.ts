'use server';
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { respondToOffer, type OfferAction } from '@/lib/offerFlow';

const UUID = /^[0-9a-f-]{36}$/i;

export async function respond(token: string, action: OfferAction, opts: { ppeTicked?: number; reason?: string } = {}) {
  if (!UUID.test(token)) return { result: 'not_found' };
  const db = createAdminClient();

  if (action === 'accept') {
    const { data: o } = await db.from('offers').select('shifts(ppe)').eq('token', token).maybeSingle();
    const ppe = (o?.shifts as unknown as { ppe: string[] } | null)?.ppe ?? [];
    if ((opts.ppeTicked ?? 0) < ppe.length) return { result: 'ppe' };
  }
  const result = await respondToOffer(db, token, action, opts.reason);
  revalidatePath(`/s/${token}`);
  return { result };
}

/** A temp tells us which days of a weekly shift they're free for. Nothing is booked until a consultant confirms. */
export async function setAvailability(token: string, offerIds: string[]) {
  if (!UUID.test(token)) return { ok: false, error: 'Link not valid.' };
  const db = createAdminClient();
  const { data: o } = await db.from('offers').select('temp_id,temps(first_name,last_name,status),shifts(series_id,client)').eq('token', token).maybeSingle();
  const series = (o?.shifts as unknown as { series_id: string | null; client: string } | null);
  const t = o?.temps as unknown as { first_name: string; last_name: string; status: string } | null;
  if (!o || !series?.series_id || !t) return { ok: false, error: 'Link not valid.' };
  if (t.status !== 'active') return { ok: false, error: 'Your profile isn’t active. Please call the office.' };
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const { data: days } = await db.from('shifts').select('id').eq('series_id', series.series_id).neq('status', 'cancelled').gte('shift_date', today);
  const { data: mine } = await db.from('offers').select('id,status,decline_reason').eq('temp_id', o.temp_id).in('shift_id', (days ?? []).map((d) => d.id));
  const now = new Date().toISOString();
  let yes = 0;
  for (const m of mine ?? []) {
    if (m.status === 'accepted' || m.status === 'noshow' || (m.status === 'declined' && m.decline_reason === 'Removed by office')) continue;
    const available = offerIds.includes(m.id);
    if (available) yes++;
    await db.from('offers').update({ available, available_at: now, ppe_confirmed: available || undefined, responded_at: now }).eq('id', m.id);
  }
  await db.from('audit_log').insert({ actor: null, action: 'offer.availability', detail: `${t.first_name} ${t.last_name} said they can do ${yes} day${yes === 1 ? '' : 's'} of ${series.client}` });
  revalidatePath(`/s/${token}`);
  return { ok: true };
}
