import 'server-only';
import { toE164 } from './phone';
import type { ParsedApplication } from './applications';

/**
 * Reads a CV-Library application notification email, as delivered by Postmark's inbound webhook.
 * The girls' Outlook forwards/redirects CV-Library emails to the Postmark inbound address.
 *
 * CV-Library emails look like:
 *   Subject: Application from 'name@example.com' for 'Warehouse Operative Picker And...' ME20 (CV-Library)
 *   Body:    You have received an application for the position of <Job Title> (Ref: ME20) ...
 *            COVER LETTER ... Yours faithfully, <Name>
 *            Additional candidate info: Jobtitle / Location / Travel / Temp/Perm / Salary
 *            .../applications/reject?id=<application id>&key=...
 *   Attachment: <First>-<Last>_cv-library.pdf
 * The phone number isn't in the email, so it's read from the CV.
 */

type Attachment = { Name?: string; Content?: string; ContentType?: string };
export type PostmarkInbound = {
  Subject?: string; TextBody?: string; HtmlBody?: string;
  From?: string; FromFull?: { Email?: string };
  Attachments?: Attachment[];
  MessageID?: string;
};

const htmlToText = (html: string) =>
  html
    .replace(/<(br|\/p|\/div|\/tr|\/li)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n');

const titleCase = (s: string) => (s === s.toUpperCase() || s === s.toLowerCase() ? s.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase()) : s);

/** True only for genuine CV-Library application emails, so nothing else gets anyone emailed or texted. */
export function isCvLibraryApplication(m: PostmarkInbound) {
  const subject = m.Subject || '';
  const body = `${m.TextBody || ''}\n${m.HtmlBody || ''}`;
  return /Application from '.+@.+' for '.*'.*\(CV-Library\)/i.test(subject) || (/cv-library/i.test(body) && /received an application for the position of/i.test(body));
}

/** UK mobile numbers found in some text, first one wins. */
export function findMobile(text: string): string | null {
  const re = /(?:\+\s?44\s?\(?0?\)?\s?|\b0)7[\d\s().-]{9,13}/g;
  for (const m of text.match(re) || []) {
    const n = toE164(m.replace(/\(0\)/, ''));
    if (n) return n;
  }
  return null;
}

async function cvText(cv: { type: string; bytes: Buffer }): Promise<string> {
  try {
    if (cv.type === 'application/pdf') {
      const { getDocumentProxy, extractText } = await import('unpdf');
      const pdf = await getDocumentProxy(new Uint8Array(cv.bytes));
      const { text } = await extractText(pdf, { mergePages: true });
      return String(text || '');
    }
    if (cv.type === 'text/plain') return cv.bytes.toString('utf8');
  } catch {
    /* unreadable CV: fall back to emailing them */
  }
  return '';
}

const CV_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  rtf: 'application/rtf',
  txt: 'text/plain',
};

export async function parseCvLibraryEmail(m: PostmarkInbound): Promise<ParsedApplication> {
  const subject = (m.Subject || '').replace(/\s+/g, ' ').trim();
  const body = m.TextBody?.trim() ? m.TextBody : htmlToText(m.HtmlBody || '');
  const all = `${subject}\n${body}`;

  const email = (subject.match(/Application from '([^']+@[^']+)'/i)?.[1] || '').toLowerCase().trim();

  // Full job title and ref are in the body; the subject truncates the title.
  const pos = body.match(/position of\s+(.+?)\s*\(Ref:\s*([^)]+)\)/i);
  const jobTitle = (pos?.[1] || subject.match(/ for '([^']+)'/i)?.[1] || '').replace(/\.\.\.$/, '').trim().slice(0, 120);
  const jobRef = (pos?.[2] || subject.match(/'\s+(\S+)\s+\(CV-Library\)/i)?.[1] || '').trim().slice(0, 60);

  const externalId = all.match(/applications\/reject\?id=(\d+)/i)?.[1] || all.match(/details\.cgi\?ref=(\d+)/i)?.[1] || '';
  const town = (body.match(/Location:\s*([^\n]+)/i)?.[1] || '').trim().slice(0, 80);

  // The CV attachment (ignore inline images such as signatures).
  const att = (m.Attachments || []).find((a) => /\.(pdf|docx?|rtf|txt)$/i.test(a.Name || '') && a.Content);
  let cv: ParsedApplication['cv'] = null;
  if (att) {
    const ext = (att.Name!.match(/\.([a-z]+)$/i)?.[1] || 'pdf').toLowerCase();
    cv = { name: att.Name!.replace(/[^a-z0-9 ._-]/gi, '').slice(0, 80) || `cv.${ext}`, type: CV_TYPES[ext] || att.ContentType || 'application/octet-stream', bytes: Buffer.from(att.Content!, 'base64') };
  }

  // Name: the cover letter sign-off, else the CV file name (Freddie-Connor_cv-library.pdf).
  let full = (body.match(/Yours (?:faithfully|sincerely),?\s*\n\s*([^\n]{2,60})/i)?.[1] || '').trim();
  if (!full && att?.Name) full = att.Name.replace(/_cv-library.*$/i, '').replace(/\.[a-z]+$/i, '').replace(/[-_]+/g, ' ').trim();
  const parts = full.split(/\s+/).filter(Boolean);
  const first = titleCase(parts[0] || '').slice(0, 60);
  const last = titleCase(parts.slice(1).join(' ')).slice(0, 60);

  // Phone: rarely in the email itself, usually on the CV.
  // Only look in CV-Library's part of the email, so a consultant's signature on a forward is never picked up.
  const start = body.search(/Dear Recruiter/i);
  let mobile = findMobile(start >= 0 ? body.slice(start) : '');
  let phoneRaw = '';
  if (!mobile && cv) mobile = findMobile(await cvText(cv));
  if (mobile) phoneRaw = mobile;

  return {
    externalId, jobRef, jobTitle, first, last, email, phoneRaw, mobile,
    postcode: '', town, cv,
    payload: { via: 'email', subject, from: m.FromFull?.Email || m.From || '', message_id: m.MessageID || '', town, cv_name: cv?.name || null },
  };
}
