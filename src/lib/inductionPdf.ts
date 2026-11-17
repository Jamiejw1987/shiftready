import 'server-only';
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage, type PDFImage } from 'pdf-lib';
import type { SupabaseClient } from '@supabase/supabase-js';
import { EVRI_HSE_V12, STATUS_PILL, briefingCode, visiblePages, fmtDay, fmtStamp, statusOf, type InductionDoc, type InductionPack, type Mark, type TempInduction } from './inductions';

type Temp = { first_name: string; last_name: string; mobile: string };
type SiteFile = { path: string; filename: string | null; created_at: string };
type Ctx = { font: PDFFont; bold: PDFFont; out: PDFDocument };

const STRIP = 50;            // points added under each original page for the signature strip
const INK = rgb(0.05, 0.1, 0.35);
const GREY = rgb(0.38, 0.4, 0.45);

async function download(db: SupabaseClient, path: string): Promise<Uint8Array> {
  const { data, error } = await db.storage.from('documents').download(path);
  if (error || !data) throw new Error(`Missing file ${path}`);
  return new Uint8Array(await data.arrayBuffer());
}

async function embedSig(out: PDFDocument, dataUrl: string | null | undefined): Promise<PDFImage | null> {
  if (!dataUrl?.startsWith('data:image/png;base64,')) return null;
  try { return await out.embedPng(Buffer.from(dataUrl.slice(22), 'base64')); } catch { return null; }
}

/**
 * Adds source pages to the output exactly as they look. Scanned pages often carry a rotation flag; those are
 * redrawn upright (still the original content, not a picture of it) so stamps line up with what people see.
 */
async function addSourcePages(out: PDFDocument, src: PDFDocument, indices: number[]): Promise<PDFPage[]> {
  const added: PDFPage[] = [];
  const copies = await out.copyPages(src, indices);
  for (const [k, i] of indices.entries()) {
    const sp = src.getPage(i);
    const rot = ((sp.getRotation().angle % 360) + 360) % 360;
    if (!rot) { added.push(out.addPage(copies[k])); continue; }
    const emb = await out.embedPage(sp);
    const W = emb.width, H = emb.height;
    const page = rot === 180 ? out.addPage([W, H]) : out.addPage([H, W]);
    if (rot === 90) page.drawPage(emb, { x: 0, y: W, rotate: degrees(-90) });
    else if (rot === 180) page.drawPage(emb, { x: W, y: H, rotate: degrees(180) });
    else page.drawPage(emb, { x: H, y: 0, rotate: degrees(90) });
    added.push(page);
  }
  return added;
}

/** WinAnsi-safe text (the standard PDF fonts can't draw emoji or unusual characters). */
const safe = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF£]/g, '');

function text(page: PDFPage, c: Ctx, s: string, x: number, y: number, size = 9, opts: { bold?: boolean; maxW?: number; color?: ReturnType<typeof rgb> } = {}) {
  const f = opts.bold ? c.bold : c.font;
  let t = safe(s), sz = size;
  if (opts.maxW) while (sz > 5 && f.widthOfTextAtSize(t, sz) > opts.maxW) sz -= 0.5;
  page.drawText(t, { x, y, size: sz, font: f, color: opts.color ?? INK });
}

function fitImage(page: PDFPage, img: PDFImage, x: number, y: number, w: number, h: number) {
  const s = Math.min(w / img.width, h / img.height);
  page.drawImage(img, { x: x + (w - img.width * s) / 2, y: y + (h - img.height * s) / 2, width: img.width * s, height: img.height * s });
}

/** Grows the page downwards (the client's page stays exactly as it was) and returns the new strip's bottom. */
function addStrip(page: PDFPage) {
  const { x, y, width, height } = page.getMediaBox();
  page.setMediaBox(x, y - STRIP, width, height + STRIP);
  page.setCropBox(x, y - STRIP, width, height + STRIP);
  page.drawRectangle({ x, y: y - STRIP, width, height: STRIP, color: rgb(0.965, 0.972, 0.99) });
  page.drawLine({ start: { x, y }, end: { x: x + width, y }, thickness: 0.8, color: rgb(0.32, 0.44, 1) });
  return { x0: x, y0: y - STRIP, width };
}

/** Fills in the worker's details on the EVRi form. `signed` adds the worker's e-signatures (left off the paper copy for day one). */
function fillEvri(page: PDFPage, n: number, c: Ctx, a: { name: string; site: string; scope: string; start: string; arrival: string; agency: string; footwear?: boolean; relevant: string[]; sig?: PDFImage | null; sigDate?: string }) {
  const T = EVRI_HSE_V12;
  if (n === 1) {
    text(page, c, a.name, T.p1.name.x, T.p1.name.y, 10, { maxW: 135 });
    text(page, c, a.site, T.p1.site.x, T.p1.site.y, 10, { maxW: 135 });
    text(page, c, a.scope, T.p1.scope.x, T.p1.scope.y, 10, { maxW: 135 });
    text(page, c, a.start, T.p1.start.x, T.p1.start.y, 10, { maxW: 135 });
    text(page, c, a.arrival, T.p1.arrival.x, T.p1.arrival.y, 10, { maxW: 70 });
    if (a.footwear != null) {
      const f = a.footwear ? T.p1.footwearYes : T.p1.footwearNo;
      page.drawEllipse({ x: f.x, y: f.y, xScale: f.rx, yScale: 8, borderColor: INK, borderWidth: 1.4 });
    }
    if (a.sig) {
      text(page, c, a.name, T.p1.workerName.x, T.p1.workerName.y, 8, { maxW: T.p1.workerName.maxW });
      fitImage(page, a.sig, T.p1.workerSig.x, T.p1.workerSig.y, T.p1.workerSig.w, T.p1.workerSig.h);
      text(page, c, a.sigDate ?? '', T.p1.workerDate.x, T.p1.workerDate.y, 8);
    }
  }
  if (n === 8) {
    text(page, c, a.site, T.p8.site.x, T.p8.site.y, 10, { maxW: 330 });
    text(page, c, a.name, T.p8.name.x, T.p8.name.y, 10, { maxW: 330 });
    text(page, c, a.agency, T.p8.agency.x, T.p8.agency.y, 10, { maxW: 330 });
    text(page, c, a.start, T.p8.commenced.x, T.p8.commenced.y, 10, { maxW: 330 });
    for (const code of a.relevant) {
      const t = T.p8.rows[code];
      if (t != null) text(page, c, 'Y', T.p8.relevantX, 841.92 - t - 12, 10, { bold: true });
    }
    if (a.sig) {
      text(page, c, a.name, T.p8.workerName.x, T.p8.workerName.y, 8, { maxW: T.p8.workerName.maxW });
      fitImage(page, a.sig, T.p8.workerSig.x, T.p8.workerSig.y, T.p8.workerSig.w, T.p8.workerSig.h);
      text(page, c, a.sigDate ?? '', T.p8.workerDate.x, T.p8.workerDate.y, 8);
    }
  }
}

function details(i: TempInduction, t: Temp, pack: InductionPack, docs: InductionDoc[]) {
  const a = i.answers ?? {};
  return {
    name: `${t.first_name} ${t.last_name}`.trim(),
    site: a.site || pack.default_site || '',
    scope: a.scope || pack.default_scope || '',
    start: a.startDate ? fmtDay(a.startDate) : '',
    arrival: a.arrival || pack.default_arrival || '',
    agency: pack.agency_name,
    footwear: a.footwear,
    relevant: docs.filter((d) => d.in_app).map((d) => briefingCode(d.title)).filter(Boolean) as string[],
  };
}

/** Pages a list of lines over as many plain A4 pages as needed. */
function listPages(c: Ctx, title: string, lines: { t: string; bold?: boolean; gap?: boolean; img?: PDFImage | null }[]) {
  let page = c.out.addPage([595.28, 841.89]);
  let y = 790;
  const head = (p: PDFPage) => { text(p, c, title, 40, 805, 14, { bold: true, color: rgb(0, 0, 0) }); };
  head(page);
  for (const l of lines) {
    const h = l.img ? 34 : l.gap ? 18 : 13;
    if (y - h < 40) { page = c.out.addPage([595.28, 841.89]); head(page); y = 790; }
    if (l.gap) y -= 6;
    if (l.img) { fitImage(page, l.img, 40, y - 28, 110, 30); text(page, c, l.t, 160, y - 16, 8.5, { color: GREY }); y -= h; continue; }
    text(page, c, l.t, 40, y, l.bold ? 10 : 8.5, { bold: l.bold, maxW: 515, color: l.bold ? rgb(0, 0, 0) : GREY });
    y -= h;
  }
}

/** The signed induction: the client's pages exactly as supplied, a signature strip under each, the form filled in, then the record. */
export async function buildSignedPdf(db: SupabaseClient, a: {
  induction: TempInduction; pack: InductionPack; docs: InductionDoc[]; marks: Mark[]; temp: Temp; siteFiles: SiteFile[];
  checkedByName?: string | null; siteByName?: string | null; sentByName?: string | null;
}) {
  const out = await PDFDocument.create();
  const c: Ctx = { out, font: await out.embedFont(StandardFonts.Helvetica), bold: await out.embedFont(StandardFonts.HelveticaBold) };
  const det = details(a.induction, a.temp, a.pack, a.docs);
  const mk = new Map(a.marks.map((m) => [`${m.doc_id}:${m.page}`, m]));
  const ref = a.induction.id.slice(0, 8).toUpperCase();
  out.setTitle(`${a.pack.name} - ${det.name}`);
  out.setAuthor('Staff Selection UK - ShiftReady');

  const inApp = a.docs.filter((d) => d.in_app);
  for (const d of inApp) {
    const src = await PDFDocument.load(await download(db, d.path), { ignoreEncryption: true });
    // Pages temps never saw (the client's blank group sign-in sheets) are left out.
    const shown = visiblePages(d).filter((n) => n <= src.getPageCount());
    const pages = await addSourcePages(out, src, shown.map((n) => n - 1));
    const docSig = mk.get(`${d.id}:0`);
    const docSigImg = await embedSig(out, docSig?.signature);
    for (let k = 0; k < pages.length; k++) {
      const n = shown[k];
      const page = pages[k];
      const m = mk.get(`${d.id}:${n}`);
      const sig = await embedSig(out, m?.signature);
      if (d.template === EVRI_HSE_V12.id && (n === 1 || n === 8)) fillEvri(page, n, c, { ...det, sig, sigDate: m ? fmtDay(m.at) : '' });
      const s = addStrip(page);
      const x = s.x0 + 16, yTop = s.y0 + STRIP - 13;
      text(page, c, `${det.name}  |  ${d.title}  |  page ${n} of ${d.page_count}`, x, yTop, 7.5, { bold: true, maxW: s.width - 190 });
      text(page, c, m
        ? `I have read this page: ${m.read_ok ? 'YES' : 'NO'}    I understand this page: ${m.understood_ok ? 'YES' : 'NO'}    ${fmtStamp(m.at)}${m.ip ? `  IP ${m.ip}` : ''}`
        : 'Not confirmed', x, yTop - 11, 7, { maxW: s.width - 190 });
      text(page, c, `Signed electronically in ShiftReady by Staff Selection UK. Ref ${ref}.`, x, yTop - 22, 6.5, { color: GREY });
      // Initials for this page, or the document signature on its last page.
      const boxX = s.x0 + s.width - 170;
      if (sig) { text(page, c, 'Initials:', boxX, yTop, 6.5, { color: GREY }); fitImage(page, sig, boxX, s.y0 + 4, 75, STRIP - 18); }
      if (k === pages.length - 1 && docSigImg) {
        text(page, c, 'Signed:', boxX + 82, yTop, 6.5, { color: GREY });
        fitImage(page, docSigImg, boxX + 82, s.y0 + 4, 75, STRIP - 18);
        text(page, c, fmtStamp(docSig!.at), boxX + 82, s.y0 + 2, 5.5, { color: GREY });
      }
    }
  }

  // Day-one paper sign-off, as photographed on site.
  for (const f of a.siteFiles) {
    try {
      const bytes = await download(db, f.path);
      if (f.path.endsWith('.pdf')) {
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        await addSourcePages(out, src, src.getPageIndices());
        continue;
      }
      const img = f.path.endsWith('.png') ? await out.embedPng(bytes) : await out.embedJpg(bytes);
      const page = out.addPage([595.28, 841.89]);
      text(page, c, `Day-one sign-off on site (photo uploaded ${fmtStamp(f.created_at)})`, 30, 820, 9, { bold: true, color: rgb(0, 0, 0) });
      fitImage(page, img, 20, 20, 555, 790);
    } catch { /* unreadable photo (e.g. HEIC): it's still on the temp's file */ }
  }

  // The record of who signed what, when, and from where.
  const st = statusOf(a.induction);
  const lines: { t: string; bold?: boolean; gap?: boolean; img?: PDFImage | null }[] = [
    { t: `${a.pack.name} - ${det.name}`, bold: true },
    { t: `Mobile ${a.temp.mobile} · ShiftReady ref ${ref}` },
    { t: `Site: ${det.site || '-'} · Scope of work: ${det.scope || '-'} · Start: ${det.start || '-'} · Arrival: ${det.arrival || '-'}` },
    { t: `Safety footwear (Part 2): ${det.footwear == null ? 'not answered' : det.footwear ? 'YES' : 'NO'}` },
    { t: 'Timeline', bold: true, gap: true },
    { t: `Sent ${fmtStamp(a.induction.sent_at)}${a.sentByName ? ` by ${a.sentByName}` : ''}` },
    { t: `Started ${fmtStamp(a.induction.started_at) || '-'}` },
    { t: `Completed and signed by the worker ${fmtStamp(a.induction.signed_at) || '- (not finished)'}${a.induction.signed_ip ? ` from IP ${a.induction.signed_ip}` : ''}` },
    { t: `Signatures checked by the office ${a.induction.checked_at ? `${fmtStamp(a.induction.checked_at)}${a.checkedByName ? ` by ${a.checkedByName}` : ''}` : '- (not yet)'}` },
    { t: `Day-one sign-off on site ${a.induction.site_signed_at ? `uploaded ${fmtStamp(a.induction.site_signed_at)}${a.siteByName ? ` by ${a.siteByName}` : ''}` : '- (not yet)'}` },
    { t: `Status: ${STATUS_PILL[st][1]}` },
    { t: 'Every confirmation and signature', bold: true, gap: true },
  ];
  for (const d of inApp) {
    lines.push({ t: d.title, bold: true, gap: true });
    for (const n of visiblePages(d)) {
      const m = mk.get(`${d.id}:${n}`);
      const t = `Page ${n}: ${m ? `read ${m.read_ok ? 'YES' : 'NO'}, understood ${m.understood_ok ? 'YES' : 'NO'} · ${fmtStamp(m.at)}${m.ip ? ` · IP ${m.ip}` : ''}` : 'not confirmed'}`;
      lines.push(m?.signature ? { t, img: await embedSig(out, m.signature) } : { t });
    }
    const ds = mk.get(`${d.id}:0`);
    if (d.sign_mode === 'document') lines.push(ds?.signature ? { t: `Document signed ${fmtStamp(ds.at)}${ds.ip ? ` · IP ${ds.ip}` : ''}${ds.user_agent ? ` · ${ds.user_agent.slice(0, 70)}` : ''}`, img: await embedSig(out, ds.signature) } : { t: 'Document not signed yet' });
  }
  listPages(c, 'Electronic signature record', lines);
  return out.save();
}

/** The day-one paper sheets, with the worker's details already printed: they sign and date on site. */
export async function buildDayOnePdf(db: SupabaseClient, a: { induction: TempInduction; pack: InductionPack; docs: InductionDoc[]; temp: Temp }) {
  const out = await PDFDocument.create();
  const c: Ctx = { out, font: await out.embedFont(StandardFonts.Helvetica), bold: await out.embedFont(StandardFonts.HelveticaBold) };
  const det = details(a.induction, a.temp, a.pack, a.docs);
  out.setTitle(`Day one sign-off - ${det.name}`);
  const ref = a.induction.id.slice(0, 8).toUpperCase();
  let any = false;
  for (const d of a.docs.filter((x) => x.site_pages.length)) {
    const src = await PDFDocument.load(await download(db, d.path), { ignoreEncryption: true });
    const idx = d.site_pages.map((n) => n - 1).filter((n) => n >= 0 && n < src.getPageCount());
    const pages = await addSourcePages(out, src, idx);
    pages.forEach((page, k) => {
      const n = idx[k] + 1;
      if (d.template === EVRI_HSE_V12.id) fillEvri(page, n, c, { ...det, footwear: undefined });
      else text(page, c, `${det.name}`, 40, page.getHeight() - 22, 10, { bold: true });
      const { x, y, width } = page.getMediaBox();
      text(page, c, `${det.name} - ShiftReady ref ${ref} - sign and date on paper, then photograph it with the ShiftReady site login`, x + 20, y + 6, 6.5, { color: GREY, maxW: width - 40 });
      any = true;
    });
  }
  if (!any) {
    const page = out.addPage([595.28, 841.89]);
    text(page, c, 'No pages in this pack are set to be printed for day one.', 40, 780, 12, { bold: true });
  }
  return out.save();
}
