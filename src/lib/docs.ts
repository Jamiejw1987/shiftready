import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export type DocKind = 'kid' | 'terms' | 'wtr' | 'privacy';
export type AppDoc = { id: string; kind: DocKind; version: number; title: string; body: string; created_at: string };

export const DOC_LABEL: Record<DocKind, string> = {
  kid: 'Key Information Document',
  terms: 'Terms of engagement',
  wtr: '48-hour week opt-out',
  privacy: 'Privacy notice',
};

/** The latest version of each document candidates read and sign. */
export async function currentDocs(db: SupabaseClient): Promise<Partial<Record<DocKind, AppDoc>>> {
  const { data } = await db.from('app_documents').select('id,kind,version,title,body,created_at').order('version', { ascending: false });
  const out: Partial<Record<DocKind, AppDoc>> = {};
  for (const d of (data ?? []) as AppDoc[]) if (!out[d.kind]) out[d.kind] = d;
  return out;
}

/** Gaps still to fill: drafts mark them like [CONFIRM: pay day]. */
export const gapsIn = (body: string) => body.match(/\[CONFIRM[^\]]*\]/g) ?? [];

/**
 * Why registration can't open yet, if anything: every document must exist and have no [CONFIRM ...] gaps left.
 * Returns plain-English problems for the staff pages.
 */
export function docProblems(docs: Partial<Record<DocKind, AppDoc>>): string[] {
  const out: string[] = [];
  for (const k of ['kid', 'terms', 'privacy', 'wtr'] as DocKind[]) {
    const d = docs[k];
    if (!d) out.push(`${DOC_LABEL[k]} hasn't been added`);
    else if (gapsIn(d.body).length) out.push(`${DOC_LABEL[k]} has ${gapsIn(d.body).length} gap${gapsIn(d.body).length === 1 ? '' : 's'} to fill`);
  }
  return out;
}

/** Fills in a candidate's details. Documents can use {full_name}, {first_name} and {date}. */
export function personalise(body: string, p: { first: string; last: string }) {
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });
  return body.replace(/\{full_name\}/g, `${p.first} ${p.last}`.trim()).replace(/\{first_name\}/g, p.first).replace(/\{date\}/g, today);
}
