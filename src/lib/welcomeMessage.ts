import { appUrl } from './texts';

/**
 * The text existing temps get when they're added (one at a time or from a CSV).
 * {first} and {link} are filled in for each person; {link} is their opt-in link.
 * Keep in step with welcomeText() in texts.ts, which is the same wording.
 */
export const DEFAULT_WELCOME_MESSAGE =
  "Hi {first}, welcome to Staff Selection UK! You've been added to our ShiftReady list. Reply YES if you're happy to get shift offers by text, or tap: {link} Reply STOP to opt out.";

/** Problems that would make the welcome unlawful or stop people opting in; empty when it's fine to send. */
export function welcomeMessageProblems(text: string): string[] {
  const t = text.trim();
  const out: string[] = [];
  if (!t) return ['Write a message'];
  if (!t.includes('{link}')) out.push('Include {link} so they can opt in to shift offers');
  if (!/\bSTOP\b/.test(t)) out.push('Keep "Reply STOP to opt out" (the law requires an easy way to opt out)');
  if (!/staff selection/i.test(t)) out.push('Say it’s from Staff Selection so they know who’s texting');
  if (t.length > 640) out.push('Keep it under 640 characters');
  return out;
}

export const isDefaultWelcome = (text: string) => text.replace(/\s+/g, ' ').trim() === DEFAULT_WELCOME_MESSAGE;

export function renderWelcomeMessage(template: string, v: { first: string; token: string }, base = appUrl()) {
  return template
    .replace(/\{first\}/g, v.first)
    .replace(/\{link\}/g, `${base}/o/${v.token}`)
    .replace(/\s+/g, ' ')
    .trim();
}
