'use server';
import { headers } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { notifyStaff } from '@/lib/clients';
import { IND_COLS, docsFor, markComplete, progress, stepsFor, type TempInduction, type Mark } from '@/lib/inductions';

type Result = { ok: boolean; error?: string };
const UUID = /^[0-9a-f-]{36}$/i;
const who = () => {
  const h = headers();
  return { ip: (h.get('x-forwarded-for') || '').split(',')[0].trim().slice(0, 60) || null, ua: (h.get('user-agent') || '').slice(0, 300) || null };
};

async function open(token: string) {
  if (!UUID.test(token)) return null;
  const db = createAdminClient();
  const { data } = await db.from('temp_inductions').select(IND_COLS).eq('token', token).maybeSingle();
  const i = data as TempInduction | null;
  if (!i || i.cancelled_at) return null;
  return { db, i };
}

/** The Part 2 question on the client's form: do they have safety footwear? */
export async function saveFootwear(token: string, yes: boolean): Promise<Result> {
  const o = await open(token);
  if (!o) return { ok: false, error: 'This link isn’t active. Please call the office.' };
  if (o.i.signed_at) return { ok: false, error: 'Already signed.' };
  await o.db.from('temp_inductions').update({ answers: { ...o.i.answers, footwear: yes }, started_at: o.i.started_at ?? new Date().toISOString() }).eq('id', o.i.id);
  return { ok: true };
}

/** Saves one page (ticks and, where needed, initials) or the signature for a whole document (page 0). */
export async function saveMark(token: string, m: { docId: string; page: number; read: boolean; understood: boolean; signature: string | null }): Promise<Result> {
  const o = await open(token);
  if (!o) return { ok: false, error: 'This link isn’t active. Please call the office.' };
  if (o.i.signed_at) return { ok: false, error: 'You’ve already signed this induction.' };
  if (!o.i.doc_ids.includes(m.docId)) return { ok: false, error: 'Unknown document.' };
  const [d] = await docsFor(o.db, [m.docId]);
  if (!d || !d.in_app || !Number.isInteger(m.page) || m.page < 0 || m.page > d.page_count) return { ok: false, error: 'Unknown page.' };
  if (m.page === 0 && d.sign_mode !== 'document') return { ok: false, error: 'Unknown page.' };
  const sig = m.signature && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(m.signature) && m.signature.length < 300_000 ? m.signature : null;
  const row = { page: m.page, read_ok: m.page === 0 ? true : !!m.read, understood_ok: m.page === 0 ? true : !!m.understood, signature: sig };
  if (!markComplete(d, row)) return { ok: false, error: m.page === 0 ? 'Please sign.' : d.sign_mode === 'every_page' ? 'Tick both boxes and initial the page.' : 'Tick both boxes.' };
  // Previous pages must be done first: nobody can skip ahead.
  const steps = stepsFor(await docsFor(o.db, o.i.doc_ids));
  const at = steps.findIndex((s) => s.docId === m.docId && s.page === m.page);
  if (at < 0) return { ok: false, error: 'Unknown page.' };
  const { data: marks } = await o.db.from('induction_marks').select('doc_id,page,read_ok,understood_ok,signature').eq('induction_id', o.i.id);
  const docs = await docsFor(o.db, o.i.doc_ids);
  const by = new Map(docs.map((x) => [x.id, x]));
  const got = new Map((marks ?? []).map((x) => [`${x.doc_id}:${x.page}`, x as Mark]));
  const missing = steps.slice(0, at).find((s) => !markComplete(by.get(s.docId)!, got.get(`${s.docId}:${s.page}`)));
  if (missing) return { ok: false, error: 'Please finish the earlier pages first.' };

  const { ip, ua } = who();
  const { data: t } = await o.db.from('temps').select('first_name,last_name').eq('id', o.i.temp_id).single();
  const { error } = await o.db.from('induction_marks').upsert({
    induction_id: o.i.id, doc_id: m.docId, ...row, signed_name: t ? `${t.first_name} ${t.last_name}` : null, at: new Date().toISOString(), ip, user_agent: ua,
  }, { onConflict: 'induction_id,doc_id,page' });
  if (error) return { ok: false, error: 'Couldn’t save. Check your signal and try again.' };
  if (!o.i.started_at) await o.db.from('temp_inductions').update({ started_at: new Date().toISOString() }).eq('id', o.i.id);
  return { ok: true };
}

/** Finishes the induction once every page and signature is in. */
export async function finish(token: string): Promise<Result> {
  const o = await open(token);
  if (!o) return { ok: false, error: 'This link isn’t active. Please call the office.' };
  if (o.i.signed_at) return { ok: true };
  const docs = await docsFor(o.db, o.i.doc_ids);
  if (docs.some((d) => d.template) && o.i.answers?.footwear == null) return { ok: false, error: 'Please answer the safety footwear question.' };
  const { data: marks } = await o.db.from('induction_marks').select('doc_id,page,read_ok,understood_ok,signature').eq('induction_id', o.i.id);
  const p = progress(docs, (marks ?? []) as Mark[]);
  if (p.done < p.total) return { ok: false, error: `There are ${p.total - p.done} pages or signatures still to do.` };
  const { ip } = who();
  await o.db.from('temp_inductions').update({ signed_at: new Date().toISOString(), signed_ip: ip }).eq('id', o.i.id);
  const [{ data: t }, { data: pack }] = await Promise.all([
    o.db.from('temps').select('first_name,last_name').eq('id', o.i.temp_id).single(),
    o.db.from('induction_packs').select('name').eq('id', o.i.pack_id).single(),
  ]);
  await notifyStaff(o.db, {
    kind: 'induction_signed', title: `${t?.first_name} ${t?.last_name} signed the ${pack?.name ?? 'induction'}`,
    body: `Check their signatures${o.i.answers?.footwear === false ? '. They said they DON’T have safety footwear' : ''}.`, link: `/inductions/${o.i.id}`,
  });
  return { ok: true };
}
