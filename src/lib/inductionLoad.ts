import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { IND_COLS, docsFor, type InductionPack, type Mark, type TempInduction } from './inductions';

/** Everything needed to show or print one induction. Pass the service-role client (reads files and marks). */
export async function loadFull(db: SupabaseClient, id: string) {
  const { data } = await db.from('temp_inductions').select(IND_COLS).eq('id', id).maybeSingle();
  const induction = data as TempInduction | null;
  if (!induction) return null;
  const [{ data: pack }, { data: temp }, docs, { data: marks }, { data: siteFiles }] = await Promise.all([
    db.from('induction_packs').select('*').eq('id', induction.pack_id).single(),
    db.from('temps').select('id,first_name,last_name,mobile').eq('id', induction.temp_id).single(),
    docsFor(db, induction.doc_ids),
    db.from('induction_marks').select('doc_id,page,read_ok,understood_ok,signature,signed_name,at,ip,user_agent').eq('induction_id', id),
    db.from('temp_documents').select('id,path,filename,created_at').eq('induction_id', id).eq('kind', 'induction_site').order('created_at'),
  ]);
  if (!pack || !temp) return null;
  return { induction, pack: pack as InductionPack, temp, docs, marks: (marks ?? []) as Mark[], siteFiles: siteFiles ?? [] };
}
