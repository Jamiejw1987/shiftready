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
