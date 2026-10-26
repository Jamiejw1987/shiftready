'use server';
import { revalidatePath } from 'next/cache';
import { requireStaff, audit } from '@/lib/auth';
import { DOC_LABEL, type DocKind } from '@/lib/docs';

/** Saves a new version. Earlier versions are kept, so you can always see exactly what each candidate signed. */
export async function publishDoc(kind: DocKind, title: string, body: string) {
  const { supabase, profile } = await requireStaff({ admin: true });
  if (!(kind in DOC_LABEL)) return { ok: false, error: 'Unknown document.' };
  const t = title.trim().slice(0, 120), b = body.replace(/\r\n/g, '\n').trim();
  if (!t || b.length < 50) return { ok: false, error: 'Add a title and the full wording.' };
  if (b.length > 60000) return { ok: false, error: 'That’s too long.' };
  const { data: last } = await supabase.from('app_documents').select('version,body,title').eq('kind', kind).order('version', { ascending: false }).limit(1).maybeSingle();
  if (last && last.body === b && last.title === t) return { ok: false, error: 'No changes to save.' };
  const version = (last?.version ?? 0) + 1;
  const { error } = await supabase.from('app_documents').insert({ kind, version, title: t, body: b, created_by: profile.id });
  if (error) return { ok: false, error: 'Couldn’t save. Try again.' };
  await audit(supabase, profile.id, 'document.published', `Published ${DOC_LABEL[kind]} version ${version}`);
  revalidatePath('/team/documents');
  revalidatePath('/registrations');
  return { ok: true, message: `Saved as version ${version}. New registrations will sign this version.` };
}
