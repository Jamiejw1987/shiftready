import { appUrl } from './texts';

/** The text job board applicants get. {first}, {job} and {link} are filled in for each person. */
export const DEFAULT_APPLY_MESSAGE =
  'Hi {first}, thanks for applying for {job} with Staff Selection UK. To be considered please register using your personal link: {link} It takes about 10 minutes. Have your share code or passport ready. Reply STOP to opt out. - Staff Selection';

export const APPLY_MESSAGE_KEY = 'apply_message';

/** Problems that would make the message unlawful or useless; empty when it's fine to save. */
export function applyMessageProblems(text: string): string[] {
  const t = text.trim();
  const out: string[] = [];
  if (!t) out.push('Write a message');
  if (!t.includes('{link}')) out.push('Include {link} so they get their registration link');
  if (!/\bSTOP\b/.test(t)) out.push('Keep "Reply STOP to opt out" (the law requires an easy way to opt out)');
  if (!/staff selection/i.test(t)) out.push('Say it’s from Staff Selection so they know who’s texting');
  if (t.length > 640) out.push('Keep it under 640 characters');
  return out;
}

export function renderApplyMessage(template: string, v: { first: string; job?: string | null; token: string }) {
  const job = (v.job || '').trim() || 'one of our jobs';
  return template
    .replace(/\{first\}/g, v.first)
    .replace(/\{job\}/g, job)
    .replace(/\{link\}/g, `${appUrl()}/r/${v.token}`)
    .replace(/\s+/g, ' ')
    .trim();
}
