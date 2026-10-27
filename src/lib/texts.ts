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

export const noShowText = (first: string, client: string, when: string) =>
  `Hi ${first}, you've been marked as a no-show for ${client}, ${when}. If you did attend (for example you were there but didn't clock in), reply ATTENDED or call the office today so we can put it right. - Staff Selection`;
export const REPLY_ATTENDED = "Thanks, we've passed this to your consultant to check with the client. We'll be in touch. - Staff Selection";

// Replies to a temp's YES / NO / STANDBY / button tap
export const replyAccepted = (client: string, when: string, site: string, bankToken?: string | null) =>
  `You're booked: ${client}, ${when}, ${site}. Please arrive 10 minutes early.${bankToken ? ` Before your first shift, add your bank details so we can pay you: ${appUrl()}/b/${bankToken}` : " We'll remind you the day before."} - Staff Selection`;
export const replyFull = (client: string, when: string) =>
  `Sorry, ${client} ${when} has just been filled. Reply STANDBY to go on standby in case someone drops out. - Staff Selection`;
export const replyDeclined = (client: string, when: string) => `Thanks for letting us know you can't do ${client} ${when}. - Staff Selection`;
export const replyStandby = (client: string, when: string) =>
  `You're on standby for ${client} ${when}. We'll message you straight away if a place comes up. - Staff Selection`;
export const replyClash = (client: string, when: string) =>
  `You're already booked on another shift at that time, so you can't take ${client} ${when}. Call the office if you need to swap. - Staff Selection`;
export const REPLY_NO_OFFER = "We couldn't find an open shift offer for you just now. Keep an eye out for the next one. - Staff Selection";
export const REPLY_ON_HOLD = 'Please call the office about this shift. - Staff Selection';
export const REPLY_HELP = 'Reply YES to accept your latest shift offer, NO to decline it, or STOP to stop shift messages. - Staff Selection';

// Registration
export const regInviteText = (first: string, token: string) =>
  `Hi ${first}, Staff Selection UK here. Please register for temp work using your personal link: ${appUrl()}/r/${token} It takes about 10 minutes. Have your share code or passport ready. Reply STOP to opt out. - Staff Selection`;
export const regApprovedText = (first: string, willGetShifts: boolean) =>
  willGetShifts
    ? `Hi ${first}, you're approved! You'll now get shift offers near you that match your skills. Reply STOP at any time to opt out. - Staff Selection`
    : `Hi ${first}, your registration with Staff Selection UK has been approved. - Staff Selection`;
export const bankLinkText = (first: string, token: string) =>
  `Hi ${first}, please add your bank details so we can pay you: ${appUrl()}/b/${token} - Staff Selection`;

// Holiday and P45 requests
const d = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' });
export const holidayRange = (start: string, end: string) => (start === end ? d(start) : `${d(start)} to ${d(end)}`);
export const holidayDecisionText = (first: string, start: string, end: string, approved: boolean, note?: string | null) =>
  `Hi ${first}, your holiday request for ${holidayRange(start, end)} has been ${approved ? 'approved' : 'declined'}.${note ? ` ${note}` : ''} - Staff Selection`;
export const p45SentText = (first: string, delivery: string | null, note?: string | null) =>
  `Hi ${first}, your P45 has been ${delivery === 'post' ? 'posted to you' : 'emailed to you'}.${note ? ` ${note}` : ''} - Staff Selection`;
export const p45DeclinedText = (first: string, note?: string | null) =>
  `Hi ${first}, we couldn't process your P45 request yet.${note ? ` ${note}` : ' Please call the office.'} - Staff Selection`;

export const myLinkText = (first: string, token: string) =>
  `Hi ${first}, here's your Staff Selection link to request holiday or your P45. Keep it for next time: ${appUrl()}/me/${token} - Staff Selection`;

// Weekly shifts
type SeriesInfo = { first: string; client: string; when: string; pay: number; ppe: string[]; token: string };
export const seriesOfferText = (o: SeriesInfo) =>
  `Shifts: ${o.client}, ${o.when}, £${o.pay.toFixed(2)}/hr.${o.ppe.length ? ` You need: ${o.ppe.join(', ').toLowerCase()}.` : ''} Tell us which days you can do: ${appUrl()}/s/${o.token} or reply ALL for every day, NO for none. - Staff Selection`;
export const seriesBookedText = (first: string, client: string, days: string, site: string, bankToken?: string | null) =>
  `Hi ${first}, you're booked: ${client}, ${days}, ${site}. Please arrive 10 minutes early. We'll check in with you before each shift.${bankToken ? ` Before your first shift, add your bank details: ${appUrl()}/b/${bankToken}` : ''} - Staff Selection`;

export const OPTED_IN_REPLY = "Thanks, you're all set. We'll message you when shifts come up near you. Reply STOP at any time to opt out. - Staff Selection";
export const OPTED_OUT_REPLY = "You've been opted out and won't get shift messages from Staff Selection. Reply START to opt back in.";
