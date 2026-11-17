import 'server-only';
import { randomUUID } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';
import { activeDocs, SITE_TYPES, type Answers, type TempInduction } from '@/lib/inductions';
import { MAX_BYTES } from '@/lib/storage';

export type SendDetails = { site: string; scope: string; startDate: string; arrival: string };
const clip = (s: string, n = 80) => (s ?? '').trim().slice(0, n);

/**
 * Sends a pack to a temp: freezes the pack as it is now, records the details printed on the form, and texts the link.
 * `text: false` attaches it without a text (e.g. when it's going out with their registration link).
 */
export async function createInduction(
  db: SupabaseClient,
  a: { tempId: string; packId: string; details: SendDetails; sentBy: string },
): Promise<{ ok: true; induction: { id: string; token: string }; packName: string } | { ok: false; error: string }> {
  const { data: pack } = await db.from('induction_packs').select('id,name,active,default_site,default_scope,default_arrival').eq('id', a.packId).maybeSingle();
  if (!pack || !pack.active) return { ok: false, error: 'That induction pack isn’t switched on.' };
  const docs = await activeDocs(db, pack.id);
  if (!docs.some((d) => d.in_app)) return { ok: false, error: 'That pack has no documents for temps to read yet. Add them on Team > Client inductions.' };
  const { data: existing } = await db.from('temp_inductions').select('id').eq('temp_id', a.tempId).eq('pack_id', pack.id).is('cancelled_at', null).maybeSingle();
  if (existing) return { ok: false, error: 'They already have this induction. Resend it from their record, or cancel it first.' };
  const answers: Answers = {
    site: clip(a.details.site) || pack.default_site || '', scope: clip(a.details.scope) || pack.default_scope || '',
    startDate: /^\d{4}-\d{2}-\d{2}$/.test(a.details.startDate) ? a.details.startDate : '', arrival: clip(a.details.arrival, 20) || pack.default_arrival || '',
  };
  const { data, error } = await db.from('temp_inductions')
    .insert({ temp_id: a.tempId, pack_id: pack.id, doc_ids: docs.map((d) => d.id), answers, sent_by: a.sentBy })
    .select('id,token').single();
  if (error || !data) return { ok: false, error: 'Couldn’t save. Has supabase/2026-11-17-inductions.sql been run?' };
  return { ok: true, induction: data, packName: pack.name };
}

export async function siteSlot(tempId: string, type: string, size: number) {
  if (!SITE_TYPES[type]) return { ok: false as const, error: 'Upload a photo (JPEG or PNG) or a PDF.' };
  if (!(size > 0 && size <= MAX_BYTES)) return { ok: false as const, error: 'Each file must be under 15 MB.' };
  const path = `${tempId}/induction_site-${randomUUID()}.${SITE_TYPES[type]}`;
  const { data, error } = await createAdminClient().storage.from('documents').createSignedUploadUrl(path);
  if (error || !data) return { ok: false as const, error: 'Couldn’t prepare the upload.' };
  return { ok: true as const, path, token: data.token };
}

/** Records photos of the signed day-one sheet and marks the induction complete. */
export async function recordSite(i: TempInduction, paths: { path: string; filename: string }[], by: { staff?: string; supervisor?: string }) {
  const db = createAdminClient();
  const valid = paths.filter((p) => p.path.startsWith(`${i.temp_id}/induction_site-`));
  const { data: listed } = await db.storage.from('documents').list(i.temp_id, { limit: 1000, search: 'induction_site-' });
  const present = new Set((listed ?? []).map((o) => `${i.temp_id}/${o.name}`));
  const rows = valid.filter((p) => present.has(p.path)).map((p) => ({
    temp_id: i.temp_id, kind: 'induction_site', path: p.path, filename: p.filename.slice(0, 120) || null, uploaded_by: by.staff ?? null, induction_id: i.id,
  }));
  if (!rows.length) return 0;
  await db.from('temp_documents').upsert(rows, { onConflict: 'path', ignoreDuplicates: true });
  await db.from('temp_inductions').update({
    site_signed_at: new Date().toISOString(), site_by_staff: by.staff ?? null, site_by_supervisor: by.supervisor ?? null,
  }).eq('id', i.id);
  return rows.length;
}

