/** Wording of every automatic text, kept in one place so it's easy to change. Plain characters only. */

export const appUrl = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');

export function welcomeText(first: string, token: string) {
  return `Hi ${first}, welcome to Staff Selection UK! You've been added to our ShiftReady list. Tap to confirm you're happy to get shift offers by text: ${appUrl()}/o/${token} Or reply YES. Reply STOP to opt out.`;
}

export function offerText(o: { client: string; when: string; pay: number; token: string }) {
  return `Shift: ${o.client}, ${o.when}, £${o.pay.toFixed(2)}/hr. View and accept: ${appUrl()}/s/${o.token} - Staff Selection`;
}

export function reminderText(o: { first: string; client: string; when: string; site: string; ppe: string[] }) {
  const bring = o.ppe.length ? ` Bring: ${o.ppe.join(', ').toLowerCase()}.` : '';
  return `Hi ${o.first}, reminder: you're booked at ${o.client} tomorrow, ${o.when}, ${o.site}.${bring} - Staff Selection`;
}

export function promotedText(o: { first: string; client: string; when: string; token: string }) {
  return `Hi ${o.first}, good news: a place came up and you've been moved from standby onto ${o.client}, ${o.when}. Details: ${appUrl()}/s/${o.token} - Staff Selection`;
}

export const OPTED_IN_REPLY = "Thanks, you're all set. We'll text you when shifts come up near you. Reply STOP at any time to opt out. - Staff Selection";
export const OPTED_OUT_REPLY = "You've been opted out and won't get shift texts from Staff Selection. Reply START to opt back in.";
