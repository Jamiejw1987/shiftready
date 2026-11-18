import 'server-only';
import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { docsFor, EVRI_HSE_V12, type InductionPack, type TempInduction } from './inductions';
import { buildDayOneSignedPdf } from './inductionPdf';
import type { DayOneInput } from './dayOneItems';

const okSig = (s: string | undefined) => !!s && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s) && s.length < 300_000;

export async function hasDayOneForm(db: SupabaseClient, i: TempInduction) {
  return (await docsFor(db, i.doc_ids)).some((d) => d.template === EVRI_HSE_V12.id);
}

export function dayOneProblems(a: DayOneInput): string | null {
  if (a.footwear == null) return 'Answer the safety footwear question.';
  if (a.footwear === false) return 'They can’t start without safety footwear. Sort their boots first.';
  const missing = [1, 2, 3, 4].filter((n) => !okSig(a.initials[String(n)]));
  if (missing.length) return `The worker needs to initial point${missing.length === 1 ? '' : 's'} ${missing.join(', ')}.`;
  if (!okSig(a.workerSig)) return 'The worker needs to sign Part 3.';
  if (!okSig(a.somSig)) return 'The worker needs to sign to confirm the SOM briefings.';
  if (!a.repName.trim()) return 'Add the site representative’s name.';
  if (!okSig(a.repSig)) return 'The site representative needs to sign.';
  return null;
}

/** Saves the day-one sign-off: the completed form goes on the temp's file and the induction is marked complete. */
export async function saveDayOne(db: SupabaseClient, i: TempInduction, a: DayOneInput, by: { staff?: string; supervisor?: string; ip?: string | null }) {
  const problem = dayOneProblems(a);
  if (problem) return { ok: false as const, error: problem };
  if (!i.signed_at) return { ok: false as const, error: 'They haven’t finished the induction on their phone yet.' };
  const [{ data: t }, { data: pack }, docs] = await Promise.all([
    db.from('temps').select('first_name,last_name,mobile').eq('id', i.temp_id).single(),
    db.from('induction_packs').select('*').eq('id', i.pack_id).single(),
    docsFor(db, i.doc_ids),
  ]);
  if (!t || !pack) return { ok: false as const, error: 'Not found.' };
  const date = new Date().toLocaleDateString('en-GB', { timeZone: 'Europe/London' });
  let bytes: Uint8Array;
  try {
    bytes = await buildDayOneSignedPdf(db, { induction: i, pack: pack as InductionPack, docs, temp: t, footwear: a.footwear!, initials: a.initials, repName: a.repName.trim().slice(0, 80), workerSig: a.workerSig, repSig: a.repSig, somSig: a.somSig, date });
  } catch (e) { return { ok: false as const, error: (e as Error).message || 'Couldn’t make the form.' }; }
  // Kept as a record alongside the manual handling assessment (same table, its own kind).
  await db.from('induction_assessments').insert({
    induction_id: i.id, kind: 'day_one', answers: { footwear: a.footwear, initials: a.initials, somSig: a.somSig }, trainer_name: a.repName.trim().slice(0, 80),
    candidate_sig: a.workerSig, trainer_sig: a.repSig, by_staff: by.staff ?? null, by_supervisor: by.supervisor ?? null, ip: by.ip ?? null,
  });
  const path = `${i.temp_id}/induction_site-${randomUUID()}.pdf`;
  const up = await db.storage.from('documents').upload(path, bytes, { contentType: 'application/pdf' });
  if (up.error) return { ok: false as const, error: 'Couldn’t save the form. Try again.' };
  await db.from('temp_documents').insert({ temp_id: i.temp_id, kind: 'induction_site', path, filename: 'Day one sign-off.pdf', uploaded_by: by.staff ?? null, induction_id: i.id });
  await db.from('temp_inductions').update({
    site_signed_at: new Date().toISOString(), site_by_staff: by.staff ?? null, site_by_supervisor: by.supervisor ?? null,
    answers: { ...i.answers, footwear: a.footwear },
  }).eq('id', i.id);
  return { ok: true as const, message: `Day one signed off. Saved to ${t.first_name}’s file.`, name: `${t.first_name} ${t.last_name}` };
}
