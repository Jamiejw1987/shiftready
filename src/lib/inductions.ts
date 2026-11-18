import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Client induction packs (e.g. the DHL / EVRi agency induction).
 *
 * The client's own PDFs are kept exactly as supplied. Temps see a picture of every page, tick that they've read
 * and understood it, and sign with their finger. The signed PDF is the client's original pages with a signature
 * strip added underneath each one, plus the client's form fields filled in where the form has them.
 * The day-one sign-off (site tour, fire exits, canteen) is done on paper on site and a photo is uploaded.
 */

export type InductionDoc = {
  id: string; pack_id: string; position: number; title: string; path: string; page_count: number;
  page_sizes: [number, number][]; page_images: string[]; template: string | null; in_app: boolean;
  sign_mode: 'document' | 'every_page'; site_pages: number[]; archived_at: string | null;
  /** Pages temps don't see, e.g. the client's blank group sign-in sheet ("Record of Instruction"). */
  hidden_pages: number[];
};
export type InductionPack = {
  id: string; name: string; client_id: string | null; default_site: string | null; default_scope: string | null;
  default_arrival: string | null; agency_name: string; active: boolean;
};
export type Answers = { site?: string; scope?: string; startDate?: string; arrival?: string; footwear?: boolean };
export type TempInduction = {
  id: string; temp_id: string; pack_id: string; doc_ids: string[]; token: string; answers: Answers;
  sent_by: string | null; sent_at: string; started_at: string | null; signed_at: string | null; signed_ip: string | null;
  checked_at: string | null; checked_by: string | null; site_signed_at: string | null; site_by_staff: string | null;
  site_by_supervisor: string | null; cancelled_at: string | null;
};
export type Mark = {
  doc_id: string; page: number; read_ok: boolean; understood_ok: boolean; signature: string | null;
  signed_name: string | null; at: string; ip: string | null; user_agent: string | null;
};

// '*' so pages keep working before supabase/2026-11-17b-hidden-pages.sql has been run.
export const DOC_COLS = '*';
const norm = (d: InductionDoc): InductionDoc => ({ ...d, hidden_pages: d.hidden_pages ?? [] });
/** Page numbers the temp actually sees. */
export const visiblePages = (d: Pick<InductionDoc, 'page_count' | 'hidden_pages'>) =>
  Array.from({ length: d.page_count }, (_, i) => i + 1).filter((n) => !(d.hidden_pages ?? []).includes(n));
export const IND_COLS = 'id,temp_id,pack_id,doc_ids,token,answers,sent_by,sent_at,started_at,signed_at,signed_ip,checked_at,checked_by,site_signed_at,site_by_staff,site_by_supervisor,cancelled_at';

export type IndStatus = 'cancelled' | 'sent' | 'in_progress' | 'signed' | 'checked' | 'complete';
export function statusOf(i: Pick<TempInduction, 'cancelled_at' | 'started_at' | 'signed_at' | 'checked_at' | 'site_signed_at'>): IndStatus {
  if (i.cancelled_at) return 'cancelled';
  if (i.site_signed_at && i.signed_at) return 'complete';
  if (i.checked_at) return 'checked';
  if (i.signed_at) return 'signed';
  if (i.started_at) return 'in_progress';
  return 'sent';
}
export const STATUS_PILL: Record<IndStatus, [string, string]> = {
  cancelled: ['mute', 'Cancelled'],
  sent: ['warn', 'Sent, not started'],
  in_progress: ['warn', 'Part done'],
  signed: ['blue', 'Signed: check signatures'],
  checked: ['blue', 'Awaiting day-one sign-off'],
  complete: ['ok', 'Fully inducted'],
};

/** Every step the temp must complete, in order: each page, then a signature for the document (unless every page is signed). */
export type Step = { docId: string; page: number };
export function stepsFor(docs: InductionDoc[]): Step[] {
  const out: Step[] = [];
  for (const d of docs.filter((x) => x.in_app)) {
    for (const p of visiblePages(d)) out.push({ docId: d.id, page: p });
    if (d.sign_mode === 'document') out.push({ docId: d.id, page: 0 });
  }
  return out;
}
/** Whether a saved mark fully completes its step. */
export function markComplete(d: InductionDoc, m: Pick<Mark, 'page' | 'read_ok' | 'understood_ok' | 'signature'> | undefined) {
  if (!m) return false;
  if (m.page === 0) return !!m.signature;
  return m.read_ok && m.understood_ok && (d.sign_mode !== 'every_page' || !!m.signature);
}
export function progress(docs: InductionDoc[], marks: Pick<Mark, 'doc_id' | 'page' | 'read_ok' | 'understood_ok' | 'signature'>[]) {
  const steps = stepsFor(docs);
  const byDoc = new Map(docs.map((d) => [d.id, d]));
  const key = (a: string, p: number) => `${a}:${p}`;
  const got = new Map(marks.map((m) => [key(m.doc_id, m.page), m]));
  const done = steps.filter((s) => markComplete(byDoc.get(s.docId)!, got.get(key(s.docId, s.page)))).length;
  return { done, total: steps.length };
}

/** Docs of an induction in the order they were sent. */
export async function docsFor(db: SupabaseClient, ids: string[]): Promise<InductionDoc[]> {
  if (!ids.length) return [];
  const { data } = await db.from('induction_docs').select(DOC_COLS).in('id', ids);
  const by = new Map(((data ?? []) as InductionDoc[]).map((d) => [d.id, norm(d)]));
  return ids.map((id) => by.get(id)).filter(Boolean) as InductionDoc[];
}

export async function activeDocs(db: SupabaseClient, packId: string): Promise<InductionDoc[]> {
  const { data } = await db.from('induction_docs').select(DOC_COLS).eq('pack_id', packId).is('archived_at', null).order('position').order('created_at');
  return ((data ?? []) as InductionDoc[]).map(norm);
}

export const fmtDay = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/London' }) : '';
export const fmtStamp = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/London' }) : '';

/** Parses "1, 8" or "all" into page numbers within the document. */
export function parsePages(text: string, count: number): number[] {
  const t = text.trim().toLowerCase();
  if (!t) return [];
  if (t === 'all') return Array.from({ length: count }, (_, i) => i + 1);
  const out = new Set<number>();
  for (const part of t.split(/[\s,]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const a = +m[1], b = m[2] ? +m[2] : a;
    for (let n = Math.min(a, b); n <= Math.max(a, b); n++) if (n >= 1 && n <= count) out.add(n);
  }
  return Array.from(out).sort((x, y) => x - y);
}

// ---------- Known client forms: where ShiftReady prints the details on the client's own form ----------

/**
 * EVRi Premium (DHL network) "Temporary Warehouse Worker Induction" v12, October 2025, 8 A4 pages.
 * Positions are in PDF points from the bottom-left, measured from the client's original file.
 * Page 1: worker details, Part 2 footwear question, Part 3 declaration. Page 8: SOM briefings table and confirmation.
 */
const H = 841.92;
const top = (t: number) => H - t;
export const EVRI_HSE_V12 = {
  id: 'evri_hse_v12',
  label: 'EVRi / DHL Temporary Warehouse Worker Induction v12',
  /** Recognised from the text on its pages. */
  detect: (text: string, pages: number) => pages === 8 && /Temporary Warehouse Worker Induction\s+v12/i.test(text),
  p1: {
    name: { x: 192, y: top(188.5) }, site: { x: 192, y: top(203) }, scope: { x: 192, y: top(218) },
    start: { x: 192, y: top(233) }, arrival: { x: 386, y: top(233) },
    footwearYes: { x: 502, y: top(276), rx: 11 }, footwearNo: { x: 528, y: top(276), rx: 10 },   // ring the printed "Yes or No"
    workerName: { x: 233, y: top(684), maxW: 84 }, workerSig: { x: 360, y: top(688), w: 122, h: 26 }, workerDate: { x: 513, y: top(684) },
    repName: { x: 233, y: top(713), maxW: 84 }, repSig: { x: 360, y: top(717), w: 122, h: 26 }, repDate: { x: 513, y: top(713) },
    // "Confirm on completion" cell for points 1 to 4: [top, bottom] from the top of the page, x from 516 to 571.
    confirmX: 516, confirmW: 55, confirmRows: [[355, 372], [372, 573], [573, 590], [590, 608]] as [number, number][],
  },
  p8: {
    site: { x: 242, y: top(127) }, name: { x: 242, y: top(143) }, agency: { x: 242, y: top(159) }, commenced: { x: 242, y: top(175) },
    relevantX: 349, dateX: 382, instructorX: 446, instructorW: 130,
    rows: {
      'WH2': 217, 'WH7': 234, 'WH11': 251, 'WH12': 268, 'WH13': 285, 'WH14': 302, 'WH16': 319, 'WH17': 336, 'WH-T18': 353,
      'WH30': 370, 'WH-T35': 387, 'WH38': 404, 'WH-T2': 421, 'WH-T13': 438, 'WH-T40': 455, 'WH-T42': 471, 'T13': 492,
      'HSE01': 513, 'HSE03': 530, 'HSE05': 547,
    } as Record<string, number>,
    rowH: 17,
    workerName: { x: 161, y: top(733), maxW: 74 }, workerSig: { x: 381, y: top(740), w: 46, h: 23 }, workerDate: { x: 481, y: top(733) },
  },
  /** Which pages the temp signs on (every page is initialled; these two carry the full declarations). */
  // Pages 1 and 8 carry the worker's details: ShiftReady fills them in on our side, so temps don't see them.
  defaults: { sign_mode: 'every_page' as const, site_pages: [1, 8], hidden_pages: [1, 8] },
  /** Pages ShiftReady fills in itself; kept in the signed PDF even when hidden from temps. */
  filledPages: [1, 8],
};
export const TEMPLATES = [EVRI_HSE_V12];
export const templateLabel = (id: string | null) => TEMPLATES.find((t) => t.id === id)?.label ?? null;

/** The SOM / briefing code a document covers, from its title, for the SOM table on the EVRi form. */
export function briefingCode(title: string): string | null {
  const t = title.toUpperCase();
  const m = t.match(/\bWH-?\s?T?\s?(\d+)/);
  if (m) {
    const isT = /\bWH-?\s?T\s?\d/.test(t);
    return isT ? `WH-T${m[1]}` : `WH${m[1]}`;
  }
  if (/GENERAL SITE SAFETY|HSE\s?01/.test(t)) return 'HSE01';
  if (/FIRE|HSE\s?03/.test(t)) return 'HSE03';
  if (/DANGEROUS GOODS|HSE\s?05/.test(t)) return 'HSE05';
  return null;
}

// ---------- Day-one photo files ----------
export const SITE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf' };
