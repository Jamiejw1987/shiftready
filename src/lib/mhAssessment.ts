import 'server-only';
import { randomUUID } from 'crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MH_ITEMS } from './mhItems';
import { docsFor, type TempInduction } from './inductions';

/**
 * Manual Handling Practical Training Assessment (the 2-page scanned sheet in the DHL pack), done in the app:
 * the trainer taps Yes or No for each check, both sign on screen, and ShiftReady rings the answers on the
 * client's own sheet and files it on the temp's record.
 *
 * Positions were measured on the sheet at 200 dpi (A4, 596 x 842 pt): points = pixels x 0.36, from the top.
 */
const PX = 0.36;
const H = 842.04;
const at = (px: number, py: number) => ({ x: px * PX, y: H - py * PX });
const YES_NO_GAP = { 1: 70, 2: 64 } as const;          // pixels from "Yes" to "No" on each page

export type MhInput = { answers: Record<string, boolean>; location: string; trainerName: string; coaching: string; candidateSig: string; trainerSig: string };

export function mhProblems(a: MhInput): string | null {
  const missing = MH_ITEMS.filter((i) => typeof a.answers[i.id] !== 'boolean');
  if (missing.length) return `Answer Yes or No for every check (${missing.length} left).`;
  if (!a.trainerName.trim()) return 'Add the trainer’s name.';
  const noSections = Array.from(new Set(MH_ITEMS.filter((i) => a.answers[i.id] === false).map((i) => i.section)));
  if (noSections.length && !a.coaching.trim()) return `There’s a No in section ${noSections.join(', ')}: say what coaching was given (the sheet asks for it).`;
  const ok = (s: string) => /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s) && s.length < 300_000;
  if (!ok(a.candidateSig)) return 'The worker needs to sign.';
  if (!ok(a.trainerSig)) return 'The trainer needs to sign.';
  return null;
}

/** Finds the two assessment sheets in the induction's pack. */
async function sheets(db: SupabaseClient, i: TempInduction) {
  const docs = await docsFor(db, i.doc_ids);
  const find = (n: 1 | 2) => docs.find((d) => /manual handling practical/i.test(d.title) && new RegExp(`part\\s*${n}\\b`, 'i').test(d.title));
  return { p1: find(1), p2: find(2) };
}
export async function hasMhSheets(db: SupabaseClient, i: TempInduction) {
  const s = await sheets(db, i);
  return !!(s.p1 && s.p2);
}

export async function buildMhPdf(db: SupabaseClient, i: TempInduction, a: MhInput & { candidate: string; date: string }) {
  const s = await sheets(db, i);
  if (!s.p1 || !s.p2) throw new Error('This pack has no manual handling assessment sheets.');
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.05, 0.1, 0.35);
  for (const [n, d] of [[1, s.p1], [2, s.p2]] as const) {
    const { data } = await db.storage.from('documents').download(d.path);
    if (!data) throw new Error('Missing sheet');
    const src = await PDFDocument.load(new Uint8Array(await data.arrayBuffer()), { ignoreEncryption: true });
    const [pg] = await out.copyPages(src, [0]);
    const page = out.addPage(pg);
    const t = (str: string, px: number, py: number, size = 10) => { const p = at(px, py); page.drawText(str.replace(/[^\x20-\x7E£]/g, ''), { x: p.x, y: p.y, size, font, color: ink }); };
    for (const item of MH_ITEMS.filter((x) => x.page === n)) {
      const yes = a.answers[item.id] === true;
      const c = at(item.x + (yes ? 21 : YES_NO_GAP[n] + 16), item.y + 13);
      page.drawEllipse({ x: c.x, y: c.y, xScale: yes ? 9 : 8, yScale: 6.5, borderColor: ink, borderWidth: 1.3 });
    }
    const sig = async (png: string, px: number, py: number, w: number, h: number) => {
      const img = await out.embedPng(Buffer.from(png.slice(22), 'base64'));
      const k = Math.min((w * PX) / img.width, (h * PX) / img.height);
      const p = at(px, py + h);
      page.drawImage(img, { x: p.x, y: p.y, width: img.width * k, height: img.height * k });
    };
    if (n === 1) {
      t(a.candidate, 352, 514); t(a.trainerName, 958, 514);
      t(a.location, 486, 548); t(a.date, 926, 552);
    } else {
      if (a.coaching.trim()) t(a.coaching.trim().slice(0, 40), 1262, 1548, 9);
      await sig(a.candidateSig, 500, 1695, 380, 80);
      t(a.date, 900, 1752, 9);
      await sig(a.trainerSig, 460, 1835, 380, 80);
      t(`${a.trainerName}, ${a.date}`, 900, 1894, 9);
    }
    page.drawText('Completed in ShiftReady by Staff Selection UK', { x: 20, y: 8, size: 6.5, font, color: rgb(0.4, 0.4, 0.45) });
  }
  return out.save();
}

/** Saves the assessment, files the completed sheet on the temp's record, and returns how many checks were Yes. */
export async function saveMh(db: SupabaseClient, i: TempInduction, a: MhInput, by: { staff?: string; supervisor?: string; ip?: string | null }) {
  const problem = mhProblems(a);
  if (problem) return { ok: false as const, error: problem };
  const { data: t } = await db.from('temps').select('first_name,last_name').eq('id', i.temp_id).single();
  const date = new Date().toLocaleDateString('en-GB', { timeZone: 'Europe/London' });
  let bytes: Uint8Array;
  try { bytes = await buildMhPdf(db, i, { ...a, candidate: `${t?.first_name ?? ''} ${t?.last_name ?? ''}`.trim(), date }); }
  catch (e) { return { ok: false as const, error: (e as Error).message || 'Couldn’t make the sheet.' }; }
  const answers = Object.fromEntries(MH_ITEMS.map((x) => [x.id, a.answers[x.id]]));
  const { error } = await db.from('induction_assessments').insert({
    induction_id: i.id, answers, location: a.location.trim().slice(0, 80) || null, trainer_name: a.trainerName.trim().slice(0, 80),
    coaching: a.coaching.trim().slice(0, 200) || null, candidate_sig: a.candidateSig, trainer_sig: a.trainerSig,
    by_staff: by.staff ?? null, by_supervisor: by.supervisor ?? null, ip: by.ip ?? null,
  });
  if (error) return { ok: false as const, error: 'Couldn’t save. Has supabase/2026-11-17c-mh-assessment.sql been run?' };
  const path = `${i.temp_id}/mh_assessment-${randomUUID()}.pdf`;
  const up = await db.storage.from('documents').upload(path, bytes, { contentType: 'application/pdf' });
  if (!up.error) await db.from('temp_documents').insert({ temp_id: i.temp_id, kind: 'mh_assessment', path, filename: 'Manual handling assessment.pdf', uploaded_by: by.staff ?? null, induction_id: i.id });
  const yes = MH_ITEMS.filter((x) => a.answers[x.id]).length;
  return { ok: true as const, message: `Saved to ${t?.first_name}’s file: ${yes} of ${MH_ITEMS.length} Yes.`, name: `${t?.first_name} ${t?.last_name}` };
}
