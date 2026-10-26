/**
 * Wording of every automatic message, kept in one place so it's easy to change. Plain characters only.
 * Each message has a text (SMS) version. Messages that can go by WhatsApp also list their template
 * values in order; the template wording itself lives in Twilio (see WHATSAPP.md).
 */

export const appUrl = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');

const listOrNone = (items: string[], none: string) => (items.length ? items.join(', ').toLowerCase() : none);

export function welcomeText(first: string, token: string) {
  return `Hi ${first}, welcome to Staff Selection UK! You've been added to our ShiftReady list. Reply YES if you're happy to get shift offers by text, or tap: ${appUrl()}/o/${token} Reply STOP to opt out.`;
}
export const welcomeWa = (first: string) => [first];

type OfferInfo = { first: string; client: string; when: string; site: string; pay: number; duties: string[]; ppe: string[]; token: string };

export function offerText(o: OfferInfo) {
  const need = o.ppe.length ? ` You need: ${listOrNone(o.ppe, '')}.` : '';
  return `Shift: ${o.client}, ${o.when}, £${o.pay.toFixed(2)}/hr.${need} Reply YES to accept${o.ppe.length ? ' (confirms you have these)' : ''} or NO to decline. Details: ${appUrl()}/s/${o.token} - Staff Selection`;
}
export const offerWa = (o: OfferInfo) => [
  o.first, o.client, o.when, o.pay.toFixed(2), o.site,
  o.duties.length ? o.duties.join('; ') : 'see details', listOrNone(o.ppe, 'nothing extra'), `${appUrl()}/s/${o.token}`,
];

type ReminderInfo = { first: string; client: string; when: string; site: string; ppe: string[] };
export function reminderText(o: ReminderInfo) {
  const bring = o.ppe.length ? ` Bring: ${listOrNone(o.ppe, '')}.` : '';
  return `Hi ${o.first}, reminder: you're booked at ${o.client} tomorrow, ${o.when}, ${o.site}.${bring} - Staff Selection`;
}
export const reminderWa = (o: ReminderInfo) => [o.first, o.client, o.when, o.site, listOrNone(o.ppe, 'nothing extra')];

type PromotedInfo = { first: string; client: string; when: string; token: string };
export function promotedText(o: PromotedInfo) {
  return `Hi ${o.first}, good news: a place came up and you've been moved from standby onto ${o.client}, ${o.when}. Details: ${appUrl()}/s/${o.token} - Staff Selection`;
}
export const promotedWa = (o: PromotedInfo) => [o.first, o.client, o.when, `${appUrl()}/s/${o.token}`];

// Replies to a temp's YES / NO / STANDBY / button tap
export const replyAccepted = (client: string, when: string, site: string) =>
  `You're booked: ${client}, ${when}, ${site}. Please arrive 10 minutes early. We'll remind you the day before. - Staff Selection`;
export const replyFull = (client: string, when: string) =>
  `Sorry, ${client} ${when} has just been filled. Reply STANDBY to go on standby in case someone drops out. - Staff Selection`;
export const replyDeclined = (client: string, when: string) => `Thanks for letting us know you can't do ${client} ${when}. - Staff Selection`;
export const replyStandby = (client: string, when: string) =>
  `You're on standby for ${client} ${when}. We'll message you straight away if a place comes up. - Staff Selection`;
export const REPLY_NO_OFFER = "We couldn't find an open shift offer for you just now. Keep an eye out for the next one. - Staff Selection";
export const REPLY_ON_HOLD = 'Please call the office about this shift. - Staff Selection';
export const REPLY_HELP = 'Reply YES to accept your latest shift offer, NO to decline it, or STOP to stop shift messages. - Staff Selection';

export const OPTED_IN_REPLY = "Thanks, you're all set. We'll message you when shifts come up near you. Reply STOP at any time to opt out. - Staff Selection";
export const OPTED_OUT_REPLY = "You've been opted out and won't get shift messages from Staff Selection. Reply START to opt back in.";
