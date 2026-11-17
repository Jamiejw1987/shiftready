'use server';
import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';
import { PDFDocument } from 'pdf-lib';
import { requireStaff, audit } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { TEMPLATES, parsePages } from '@/lib/inductions';
import { hashPassword, passwordProblem } from '@/lib/siteAuth';

type Result = { ok: boolean; error?: string; message?: string };
const clean = (s: string | null | undefined, n = 120) => (s ?? '').trim().slice(0, n) || null;

export type PackInput = { name: string; clientId: string; site: string; scope: string; arrival: string; agency: string };

export async function savePack(id: string | null, p: PackInput): Promise<Result & { id?: string }> {
  const { supabase, profile } = await requireStaff({ admin: true });
  const name = clean(p.name);
  if (!name) return { ok: false, error: 'Give the pack a name, e.g. DHL induction.' };
  const row = {
    name, client_id: p.clientId || null, default_site: clean(p.site), default_scope: clean(p.scope),
    default_arrival: clean(p.arrival, 20), agency_name: clean(p.agency) ?? 'Staff Selection UK Ltd',
  };
  if (id) {
    const { error } = await supabase.from('induction_packs').update(row).eq('id', id);
    if (error) return { ok: false, error: 'Couldn’t save. Has supabase/2026-11-17-inductions.sql been run?' };
    await audit(supabase, profile.id, 'induction.pack_updated', `Updated induction pack ${name}`);
    revalidatePath(`/team/inductions/${id}`);
    return { ok: true, message: 'Saved.', id };
  }
  const { data, error } = await supabase.from('induction_packs').insert({ ...row, created_by: profile.id }).select('id').single();
  if (error || !data) return { ok: false, error: 'Couldn’t save. Has supabase/2026-11-17-inductions.sql been run in Supabase?' };
  await audit(supabase, profile.id, 'induction.pack_created', `Created induction pack ${name}`);
  revalidatePath('/team/inductions');
  return { ok: true, id: data.id };
}

export async function setPackActive(id: string, active: boolean): Promise<Result> {
  const { supabase, profile } = await requireStaff({ admin: true });
  await supabase.from('induction_packs').update({ active }).eq('id', id);
  await audit(supabase, profile.id, 'induction.pack_active', `${active ? 'Switched on' : 'Switched off'} induction pack ${id}`);
  revalidatePath(`/team/inductions/${id}`);
  return { ok: true, message: active ? 'Switched on.' : 'Switched off. Nobody new can be sent it.' };
}

/** Upload slots for one PDF and a picture of each of its pages (pictures are made in the admin's browser). */
export async function docUploadSlots(packId: string, pages: number, pdfSize: number) {
  await requireStaff({ admin: true });
  if (!(pages > 0 && pages <= 80)) return { ok: false as const, error: 'PDFs must have 1 to 80 pages.' };
  if (!(pdfSize > 0 && pdfSize <= 25 * 1024 * 1024)) return { ok: false as const, error: 'Each PDF must be under 25 MB.' };
  const db = createAdminClient();
  const docId = randomUUID();
  const base = `induction-packs/${packId}/${docId}`;
  const make = async (path: string) => {
    const { data, error } = await db.storage.from('documents').createSignedUploadUrl(path);
    if (error || !data) throw new Error('slot');
    return { path, token: data.token };
  };
  try {
    const pdf = await make(`${base}.pdf`);
    const images = [];
    for (let n = 1; n <= pages; n++) images.push(await make(`${base}-p${n}.jpg`));
    return { ok: true as const, docId, pdf, images };
  } catch {
    return { ok: false as const, error: 'Couldn’t prepare the upload. Try again.' };
  }
}

/** Checks the uploaded PDF and pictures arrived, reads the PDF's pages and recognises known client forms. */
export async function registerDoc(packId: string, docId: string, title: string, pages: number): Promise<Result> {
  const { supabase, profile } = await requireStaff({ admin: true });
  const db = createAdminClient();
  const base = `induction-packs/${packId}/${docId}`;
  const { data: listed } = await db.storage.from('documents').list(`induction-packs/${packId}`, { limit: 1000, search: docId });
  const have = new Set((listed ?? []).map((o) => `induction-packs/${packId}/${o.name}`));
  const images = Array.from({ length: pages }, (_, i) => `${base}-p${i + 1}.jpg`);
  if (!have.has(`${base}.pdf`) || images.some((p) => !have.has(p))) return { ok: false, error: 'Some of the upload didn’t arrive. Try that file again.' };

  const { data: file } = await db.storage.from('documents').download(`${base}.pdf`);
  if (!file) return { ok: false, error: 'Couldn’t read the PDF back.' };
  const bytes = new Uint8Array(await file.arrayBuffer());
  let sizes: [number, number][];
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
    sizes = pdf.getPages().map((p) => {
      const w = Math.round(p.getWidth() * 100) / 100, h = Math.round(p.getHeight() * 100) / 100;
      return p.getRotation().angle % 180 ? [h, w] : [w, h];   // as displayed (scans are often rotated)
    });
  } catch {
    return { ok: false, error: `${title}: this PDF can’t be read. Try saving it again as a PDF.` };
  }
  if (sizes.length !== pages) return { ok: false, error: `${title}: page count didn’t match. Try again.` };

  let pageText: string[] = [];
  try {
    const { getDocumentProxy, extractText } = await import('unpdf');
    const r = await extractText(await getDocumentProxy(bytes.slice()), { mergePages: false });
    pageText = (r.text as unknown as string[]) || [];
  } catch { /* scanned pages have no text: fine */ }
  const text = pageText.join('\n');
  // The client's blank group sign-in sheet for briefings done on site: temps sign electronically instead.
  const sheets = pageText.map((t, i) => (/Record of Instruction/i.test(t) ? i + 1 : 0)).filter(Boolean);
  const tpl = TEMPLATES.find((t) => t.detect(text, pages)) ?? null;

  const { data: last } = await supabase.from('induction_docs').select('position').eq('pack_id', packId).order('position', { ascending: false }).limit(1).maybeSingle();
  const row = {
    id: docId, pack_id: packId, position: (last?.position ?? -1) + 1, title: title.trim().slice(0, 140) || 'Document',
    path: `${base}.pdf`, page_count: pages, page_sizes: sizes, page_images: images,
    template: tpl?.id ?? null, sign_mode: tpl?.defaults.sign_mode ?? 'document', site_pages: tpl?.defaults.site_pages ?? [],
  };
  const hidden = tpl || sheets.length >= pages ? [] : sheets;
  let { error } = await supabase.from('induction_docs').insert({ ...row, hidden_pages: hidden });
  if (error && /hidden_pages/.test(error.message)) ({ error } = await supabase.from('induction_docs').insert(row));
  if (error) return { ok: false, error: 'Couldn’t save the document.' };
  await audit(supabase, profile.id, 'induction.doc_added', `Added "${title}" (${pages} pages) to induction pack ${packId}`);
  revalidatePath(`/team/inductions/${packId}`);
  return { ok: true, message: tpl ? `Recognised as the ${tpl.label}: details will be printed on it.` : hidden.length ? `Added. Page ${hidden.join(', ')} (blank sign-in sheet) is hidden from temps.` : 'Added.' };
}

export async function updateDoc(id: string, d: { title: string; inApp: boolean; signMode: 'document' | 'every_page'; sitePages: string; hiddenPages: string }): Promise<Result> {
  const { supabase, profile } = await requireStaff({ admin: true });
  const { data: doc } = await supabase.from('induction_docs').select('pack_id,page_count').eq('id', id).single();
  if (!doc) return { ok: false, error: 'Not found.' };
  const site = parsePages(d.sitePages, doc.page_count);
  const hidden = parsePages(d.hiddenPages, doc.page_count);
  if (d.inApp && hidden.length >= doc.page_count) return { ok: false, error: 'You can’t hide every page.' };
  if (!d.inApp && !site.length) return { ok: false, error: 'If temps don’t read it in the app, set which pages are printed for day one.' };
  const { error } = await supabase.from('induction_docs').update({
    title: d.title.trim().slice(0, 140) || 'Document', in_app: d.inApp, sign_mode: d.signMode === 'every_page' ? 'every_page' : 'document', site_pages: site, hidden_pages: hidden,
  }).eq('id', id);
  if (error) return { ok: false, error: 'Couldn’t save. Has supabase/2026-11-17b-hidden-pages.sql been run?' };
  await audit(supabase, profile.id, 'induction.doc_updated', `Updated "${d.title}" in induction pack ${doc.pack_id}`);
  revalidatePath(`/team/inductions/${doc.pack_id}`);
  return { ok: true, message: 'Saved. Applies to inductions sent from now on.' };
}

export async function moveDoc(id: string, dir: -1 | 1): Promise<Result> {
  const { supabase } = await requireStaff({ admin: true });
  const { data: doc } = await supabase.from('induction_docs').select('pack_id').eq('id', id).single();
  if (!doc) return { ok: false, error: 'Not found.' };
  const { data: list } = await supabase.from('induction_docs').select('id').eq('pack_id', doc.pack_id).is('archived_at', null).order('position').order('created_at');
  const ids = (list ?? []).map((r) => r.id);
  const i = ids.indexOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return { ok: true };
  [ids[i], ids[j]] = [ids[j], ids[i]];
  await Promise.all(ids.map((x, k) => supabase.from('induction_docs').update({ position: k }).eq('id', x)));
  revalidatePath(`/team/inductions/${doc.pack_id}`);
  return { ok: true };
}

/** Takes a document out of the pack. Kept on file so inductions already sent still open and download. */
export async function removeDoc(id: string): Promise<Result> {
  const { supabase, profile } = await requireStaff({ admin: true });
  const { data: doc } = await supabase.from('induction_docs').select('pack_id,title').eq('id', id).single();
  if (!doc) return { ok: false, error: 'Not found.' };
  await supabase.from('induction_docs').update({ archived_at: new Date().toISOString() }).eq('id', id);
  await audit(supabase, profile.id, 'induction.doc_removed', `Removed "${doc.title}" from induction pack ${doc.pack_id}`);
  revalidatePath(`/team/inductions/${doc.pack_id}`);
  return { ok: true, message: 'Removed from the pack.' };
}

// ---------- Site supervisor logins ----------

export async function createSupervisor(s: { username: string; fullName: string; password: string; clientId: string }): Promise<Result> {
  const { supabase, profile } = await requireStaff({ admin: true });
  const username = s.username.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) return { ok: false, error: 'Username: 3 to 40 letters, numbers, dots or dashes, no spaces.' };
  if (!s.fullName.trim()) return { ok: false, error: 'Add their name.' };
  const p = passwordProblem(s.password);
  if (p) return { ok: false, error: p };
  const db = createAdminClient();
  const { error } = await db.from('site_supervisors').insert({
    username, full_name: s.fullName.trim().slice(0, 80), password_hash: hashPassword(s.password), client_id: s.clientId || null, created_by: profile.id,
  });
  if (error) return { ok: false, error: error.code === '23505' ? 'That username is taken.' : 'Couldn’t save. Has supabase/2026-11-17-inductions.sql been run?' };
  await audit(supabase, profile.id, 'site_supervisor.created', `Created site login ${username} for ${s.fullName.trim()}`);
  revalidatePath('/team/inductions');
  return { ok: true, message: `Login created. Give ${s.fullName.trim().split(' ')[0]} the username and password; they sign in at /site.` };
}

export async function resetSupervisorPassword(id: string, password: string): Promise<Result> {
  const { supabase, profile } = await requireStaff({ admin: true });
  const p = passwordProblem(password);
  if (p) return { ok: false, error: p };
  const db = createAdminClient();
  const { data: s } = await db.from('site_supervisors').select('username,session_version').eq('id', id).single();
  if (!s) return { ok: false, error: 'Not found.' };
  await db.from('site_supervisors').update({ password_hash: hashPassword(password), session_version: s.session_version + 1 }).eq('id', id);
  await audit(supabase, profile.id, 'site_supervisor.password_reset', `Reset the password for site login ${s.username}`);
  return { ok: true, message: 'Password changed. They’re signed out everywhere.' };
}

export async function setSupervisorActive(id: string, active: boolean): Promise<Result> {
  const { supabase, profile } = await requireStaff({ admin: true });
  const db = createAdminClient();
  const { data: s } = await db.from('site_supervisors').select('username,session_version').eq('id', id).single();
  if (!s) return { ok: false, error: 'Not found.' };
  await db.from('site_supervisors').update({ active, session_version: s.session_version + 1 }).eq('id', id);
  await audit(supabase, profile.id, 'site_supervisor.active', `${active ? 'Switched on' : 'Switched off'} site login ${s.username}`);
  revalidatePath('/team/inductions');
  return { ok: true };
}
