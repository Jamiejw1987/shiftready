'use server';
import { revalidatePath } from 'next/cache';
import { requireStaff, audit } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendToTemp } from '@/lib/sms';
import { inductionText } from '@/lib/texts';
import { IND_COLS, statusOf, type Answers, type TempInduction } from '@/lib/inductions';
import { createInduction, siteSlot, recordSite, type SendDetails } from '@/lib/inductionOps';

type Result = { ok: boolean; error?: string; message?: string };
const clip = (s: string, n = 80) => s.trim().slice(0, n);

async function load(supabase: Awaited<ReturnType<typeof requireStaff>>['supabase'], id: string) {
  const { data } = await supabase.from('temp_inductions').select(IND_COLS).eq('id', id).maybeSingle();
  return data as TempInduction | null;
}
const refresh = (tempId: string, id?: string) => { revalidatePath(`/temps/${tempId}`); if (id) revalidatePath(`/inductions/${id}`); };

export async function sendInduction(tempId: string, packId: string, details: SendDetails): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const { data: t } = await supabase.from('temps').select('id,first_name,last_name,mobile,status').eq('id', tempId).single();
  if (!t) return { ok: false, error: 'Not found.' };
  const c = await createInduction(supabase, { tempId, packId, details, sentBy: profile.id });
  if (!c.ok) return c;
  const r = t.status === 'out' ? { ok: false, error: 'opted out of texts' } : await sendToTemp({ db: supabase, temp: t, kind: 'induction', sentBy: profile.id, body: inductionText(t.first_name, c.packName, c.induction.token) });
  await audit(supabase, profile.id, 'induction.sent', `Sent the ${c.packName} to ${t.first_name} ${t.last_name}${r.ok ? '' : ' - text not sent'}`);
  refresh(tempId);
  return r.ok ? { ok: true, message: `${c.packName} sent to ${t.first_name}.` } : { ok: true, message: `Added. No text was sent (${r.error}): use Copy link and send it to ${t.first_name} yourself.` };
}

export async function resendInduction(id: string): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const i = await load(supabase, id);
  if (!i || i.cancelled_at) return { ok: false, error: 'Not found.' };
  if (i.signed_at) return { ok: false, error: 'Already signed.' };
  const [{ data: t }, { data: pack }] = await Promise.all([
    supabase.from('temps').select('id,first_name,last_name,mobile').eq('id', i.temp_id).single(),
    supabase.from('induction_packs').select('name').eq('id', i.pack_id).single(),
  ]);
  if (!t || !pack) return { ok: false, error: 'Not found.' };
  const r = await sendToTemp({ db: supabase, temp: t, kind: 'induction', sentBy: profile.id, body: inductionText(t.first_name, pack.name, i.token) });
  await audit(supabase, profile.id, 'induction.resent', `Resent the ${pack.name} to ${t.first_name} ${t.last_name}`);
  return r.ok ? { ok: true, message: 'Link sent again.' } : { ok: false, error: `Text failed: ${r.error}` };
}

export async function inductionLink(id: string): Promise<string> {
  const { supabase } = await requireStaff();
  const i = await load(supabase, id);
  return i ? `${(process.env.APP_URL || '').replace(/\/$/, '')}/i/${i.token}` : '';
}

/** Changes the details printed on the form (site, scope, start date, arrival). */
export async function updateInductionDetails(id: string, d: SendDetails): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const i = await load(supabase, id);
  if (!i) return { ok: false, error: 'Not found.' };
  const answers: Answers = { ...i.answers, site: clip(d.site), scope: clip(d.scope), startDate: /^\d{4}-\d{2}-\d{2}$/.test(d.startDate) ? d.startDate : '', arrival: clip(d.arrival, 20) };
  await supabase.from('temp_inductions').update({ answers }).eq('id', id);
  await audit(supabase, profile.id, 'induction.details', `Changed induction form details (${answers.site}, ${answers.startDate}, ${answers.arrival})`);
  refresh(i.temp_id, id);
  return { ok: true, message: 'Saved.' };
}

/** Office has looked at every signature: OK to go to site. */
export async function setChecked(id: string, ok: boolean): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const i = await load(supabase, id);
  if (!i || i.cancelled_at) return { ok: false, error: 'Not found.' };
  if (ok && !i.signed_at) return { ok: false, error: 'They haven’t finished signing yet.' };
  await supabase.from('temp_inductions').update(ok ? { checked_at: new Date().toISOString(), checked_by: profile.id } : { checked_at: null, checked_by: null }).eq('id', id);
  await audit(supabase, profile.id, ok ? 'induction.checked' : 'induction.unchecked', `${ok ? 'Checked' : 'Un-checked'} induction signatures (${id.slice(0, 8)})`);
  refresh(i.temp_id, id);
  return { ok: true, message: ok ? 'Marked as checked: OK for site.' : 'Check removed.' };
}

/** Sends a signed induction back to the temp to do again (e.g. a signature was a scribble). Their old marks are cleared. */
export async function reopenInduction(id: string): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const i = await load(supabase, id);
  if (!i || i.cancelled_at) return { ok: false, error: 'Not found.' };
  const db = createAdminClient();
  await db.from('induction_marks').delete().eq('induction_id', id);
  await db.from('temp_inductions').update({ started_at: null, signed_at: null, signed_ip: null, checked_at: null, checked_by: null }).eq('id', id);
  await audit(supabase, profile.id, 'induction.reopened', `Cleared signatures and reopened induction ${id.slice(0, 8)} for the temp to sign again`);
  refresh(i.temp_id, id);
  return { ok: true, message: 'Cleared. Use Resend link so they can sign again.' };
}

export async function cancelInduction(id: string): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const i = await load(supabase, id);
  if (!i) return { ok: false, error: 'Not found.' };
  await supabase.from('temp_inductions').update({ cancelled_at: new Date().toISOString() }).eq('id', id);
  await audit(supabase, profile.id, 'induction.cancelled', `Cancelled induction ${id.slice(0, 8)}`);
  refresh(i.temp_id, id);
  return { ok: true, message: 'Cancelled. Their link no longer works.' };
}

// ---------- Day-one photo, uploaded by the office (site supervisors use /site) ----------

export async function siteSlotStaff(id: string, type: string, size: number) {
  const { supabase } = await requireStaff();
  const i = await load(supabase, id);
  if (!i || i.cancelled_at) return { ok: false as const, error: 'Not found.' };
  return siteSlot(i.temp_id, type, size);
}

export async function recordSiteStaff(id: string, paths: { path: string; filename: string }[]): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const i = await load(supabase, id);
  if (!i || i.cancelled_at) return { ok: false, error: 'Not found.' };
  const n = await recordSite(i, paths, { staff: profile.id });
  if (!n) return { ok: false, error: 'The upload didn’t arrive. Try again.' };
  await audit(supabase, profile.id, 'induction.site_uploaded', `Uploaded the day-one sign-off (${n} file${n === 1 ? '' : 's'}) for induction ${id.slice(0, 8)}`);
  refresh(i.temp_id, id);
  const st = statusOf({ ...i, site_signed_at: 'now' });
  return { ok: true, message: st === 'complete' ? 'Uploaded. Fully inducted.' : 'Uploaded. They still need to finish signing in the app.' };
}

/** Manual handling practical assessment done in the app by office staff. */
export async function saveMhStaff(id: string, p: import('@/lib/mhAssessment').MhInput): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const i = await load(supabase, id);
  if (!i || i.cancelled_at) return { ok: false, error: 'Not found.' };
  const { saveMh } = await import('@/lib/mhAssessment');
  const r = await saveMh(createAdminClient(), i, p, { staff: profile.id });
  if (!r.ok) return r;
  await audit(supabase, profile.id, 'induction.mh_assessment', `Recorded the manual handling assessment for ${r.name} (trainer ${p.trainerName.trim()})`);
  refresh(i.temp_id, id);
  return { ok: true, message: r.message };
}

/** DHL's day-one sign-off done on screen by office staff. */
export async function saveDayOneStaff(id: string, p: import('@/lib/dayOneItems').DayOneInput): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const i = await load(supabase, id);
  if (!i || i.cancelled_at) return { ok: false, error: 'Not found.' };
  const { saveDayOne } = await import('@/lib/dayOne');
  const r = await saveDayOne(createAdminClient(), i, p, { staff: profile.id });
  if (!r.ok) return r;
  await audit(supabase, profile.id, 'induction.day_one', `Completed the day-one sign-off for ${r.name} (site rep ${p.repName.trim()})`);
  refresh(i.temp_id, id);
  return { ok: true, message: r.message };
}

/** They've done every page and signature but never pressed Submit: mark it signed for them. */
export async function markSignedStaff(id: string): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const i = await load(supabase, id);
  if (!i || i.cancelled_at) return { ok: false, error: 'Not found.' };
  if (i.signed_at) return { ok: true, message: 'Already signed.' };
  const db = createAdminClient();
  const { docsFor, progress } = await import('@/lib/inductions');
  const docs = await docsFor(db, i.doc_ids);
  const { data: marks } = await db.from('induction_marks').select('doc_id,page,read_ok,understood_ok,signature').eq('induction_id', id);
  const p = progress(docs, (marks ?? []) as never);
  if (p.done < p.total) return { ok: false, error: `They still have ${p.total - p.done} pages or signatures to do. Resend the link.` };
  const last = (marks ?? []).length ? await db.from('induction_marks').select('at,ip').eq('induction_id', id).order('at', { ascending: false }).limit(1).maybeSingle() : { data: null };
  await db.from('temp_inductions').update({ signed_at: last.data?.at ?? new Date().toISOString(), signed_ip: last.data?.ip ?? null }).eq('id', id);
  await audit(supabase, profile.id, 'induction.marked_signed', `Marked induction ${id.slice(0, 8)} as signed: every page and signature was done but Submit wasn't pressed`);
  refresh(i.temp_id, id);
  return { ok: true, message: 'Marked as signed. Check their signatures below.' };
}
