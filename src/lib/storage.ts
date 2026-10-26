import 'server-only';
import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export const DOC_KINDS = ['passport', 'id', 'rtw_check', 'ni_proof', 'flt_licence', 'other'] as const;
export type DocKindFile = (typeof DOC_KINDS)[number];
export const DOC_KIND_LABEL: Record<DocKindFile, string> = {
  passport: 'Passport', id: 'Photo ID', rtw_check: 'Right to work check result', ni_proof: 'Proof of NI number', flt_licence: 'FLT licence', other: 'Other document',
};
const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf',
};
export const MAX_BYTES = 15 * 1024 * 1024;

/** Hands out one-time upload slots in the private "documents" bucket, inside the temp's own folder. */
export async function uploadSlots(db: SupabaseClient, tempId: string, files: { kind: string; type: string; size: number }[]) {
  if (files.length > 8) return { ok: false as const, error: 'Too many files.' };
  const slots: { path: string; token: string }[] = [];
  for (const f of files) {
    if (!(DOC_KINDS as readonly string[]).includes(f.kind)) return { ok: false as const, error: 'Unknown document type.' };
    if (!EXT[f.type]) return { ok: false as const, error: 'Please upload a photo (JPEG or PNG) or a PDF.' };
    if (!(f.size > 0 && f.size <= MAX_BYTES)) return { ok: false as const, error: 'Each file must be under 15 MB.' };
    const path = `${tempId}/${f.kind}-${randomUUID()}.${EXT[f.type]}`;
    const { data, error } = await db.storage.from('documents').createSignedUploadUrl(path);
    if (error || !data) return { ok: false as const, error: 'Couldn’t prepare the upload. Please try again.' };
    slots.push({ path, token: data.token });
  }
  return { ok: true as const, slots };
}

/** Records uploaded files, ignoring anything outside this temp's folder or that never actually arrived. */
export async function recordUploads(db: SupabaseClient, tempId: string, uploads: { kind: string; path: string; filename?: string }[], uploadedBy: string | null) {
  const valid = uploads.filter((u) => u.path.startsWith(`${tempId}/`) && (DOC_KINDS as readonly string[]).includes(u.kind));
  if (!valid.length) return 0;
  const { data: listed } = await db.storage.from('documents').list(tempId, { limit: 1000 });
  const present = new Set((listed ?? []).map((o) => `${tempId}/${o.name}`));
  const rows = valid.filter((u) => present.has(u.path)).map((u) => ({ temp_id: tempId, kind: u.kind, path: u.path, filename: (u.filename || '').slice(0, 120) || null, uploaded_by: uploadedBy }));
  if (rows.length) await db.from('temp_documents').upsert(rows, { onConflict: 'path', ignoreDuplicates: true });
  return rows.length;
}

/** Deletes every stored file for a temp (used when an admin erases their record). */
export async function removeTempFiles(db: SupabaseClient, tempId: string) {
  const { data } = await db.storage.from('documents').list(tempId, { limit: 1000 });
  const paths = (data ?? []).map((o) => `${tempId}/${o.name}`);
  if (paths.length) await db.storage.from('documents').remove(paths);
  return paths.length;
}
