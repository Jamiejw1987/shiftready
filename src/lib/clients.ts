import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail, clientStream, esc } from './email';
import { sendMany, sendSms } from './sms';
import { appUrl } from './texts';
import { hhmm } from './format';
import { londonToDate } from './when';

/** Client portal helpers shared by the portal and the office screens. Always called with the service-role client. */

export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const plusDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const dayName = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** "today (Tue 3 Nov)", "tomorrow (Wed 4 Nov)" or "Fri 6 Nov". */
export function whenWord(date: string) {
  const t = today();
  if (date === t) return `today (${dayName(date)})`;
  if (date === plusDays(t, 1)) return `tomorrow (${dayName(date)})`;
  return dayName(date);
}

/** When a request starts, as a real moment in time. */
export const startsAt = (r: { request_date: string; start_time: string }) => londonToDate(r.request_date, hhmm(r.start_time));
export const hoursUntil = (r: { request_date: string; start_time: string }) => (startsAt(r).getTime() - Date.now()) / 36e5;
export const hasStarted = (r: { request_date: string; start_time: string }) => hoursUntil(r) <= 0;

export type ClientAudit = {
  action: string; detail: string; clientId: string | null; clientUserId?: string | null; actor?: string | null;
  entity?: string | null; entityId?: string | null; before?: unknown; after?: unknown;
};

/** Records something a client user (or the office, on a client's records) did. */
export async function clientAudit(db: SupabaseClient, a: ClientAudit) {
  await db.from('audit_log').insert({
    actor: a.actor ?? null, action: a.action, detail: a.detail, client_id: a.clientId, client_user_id: a.clientUserId ?? null,
    entity: a.entity ?? null, entity_id: a.entityId ?? null, before: a.before ?? null, after: a.after ?? null,
  });
}

// ---------- Sign-in links ----------

/**
 * Emails a client user a one-time sign-in link. Supabase makes the link; ShiftReady emails it through the
 * client stream so the wording is ours. In dry-run (no Postmark) the link is returned so the office can test.
 */
export async function sendClientLink(db: SupabaseClient, cu: { email: string; full_name: string | null }, clientName: string, invite: boolean) {
  const { data, error } = await db.auth.admin.generateLink({ type: 'magiclink', email: cu.email });
  if (error || !data?.properties?.hashed_token) return { ok: false as const, error: error?.message || 'Could not make a sign-in link.' };
  const link = `${appUrl()}/portal/auth?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=magiclink`;
  const first = (cu.full_name || '').split(' ')[0] || 'there';
  const subject = invite ? `Your ShiftReady access for ${clientName}` : 'Your ShiftReady sign-in link';
  const intro = invite
    ? `Staff Selection UK has given you access to ShiftReady for ${clientName}. You can request shifts, see who's booked and mark attendance.`
    : 'Here is your link to sign in to ShiftReady.';
  const text = [`Hi ${first},`, '', intro, '', 'Sign in here (no password needed):', link, '',
    'The link works once and expires soon. If it has expired, go to ' + `${appUrl()}/portal/login` + ' and ask for a new one.', '',
    'Tip: once you are in, add ShiftReady to your home screen so it opens like an app.', '', 'Staff Selection UK'].join('\n');
  const html = `<p>Hi ${esc(first)},</p><p>${esc(intro)}</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#5270ff;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Sign in to ShiftReady</a></p>
<p style="color:#5d6676;font-size:14px">No password needed. The link works once and expires soon. If it has expired, go to <a href="${esc(appUrl())}/portal/login">${esc(appUrl())}/portal/login</a> and ask for a new one.</p>
<p style="color:#5d6676;font-size:14px">Tip: once you're in, add ShiftReady to your home screen so it opens like an app.</p>
<p>Staff Selection UK</p>`;
  const r = await sendEmail({ to: cu.email, subject, text, html, tag: invite ? 'client-invite' : 'client-signin', stream: clientStream() });
  if (!r.ok) return { ok: false as const, error: r.error || 'Email failed.' };
  return { ok: true as const, dryRunLink: r.status === 'dry-run' ? link : null };
}

// ---------- Alerts to the office ----------

type StaffAlert = {
  kind: string; title: string; body?: string; link: string; urgent?: boolean; clientId?: string | null; requestId?: string | null;
  /** Text message to every office user with a mobile and SMS alerts on. Leave out for in-app only. */
  sms?: string;
  /** Email to every office user who hasn't muted client emails. Leave out for in-app only. */
  email?: { subject: string; text: string };
};

/** Tells everyone in the office: in the app always, and by text and email when given. */
export async function notifyStaff(db: SupabaseClient, a: StaffAlert) {
  await db.from('staff_notifications').insert({
    kind: a.kind, title: a.title, body: a.body ?? null, link: a.link, urgent: !!a.urgent, client_id: a.clientId ?? null, request_id: a.requestId ?? null,
  });
  if (!a.sms && !a.email) return;
  const { data: staff } = await db.from('profiles').select('id,email,mobile,client_email_alerts,client_sms_alerts').eq('active', true);
  const list = staff ?? [];
  if (a.sms) {
    const body = a.sms;
    await sendMany(list.filter((p) => p.mobile && p.client_sms_alerts), (p) => sendSms({ db, to: p.mobile!, body, kind: 'client_alert' }));
  }
  if (a.email) {
    const e = a.email;
    const html = `<p>${esc(e.text).replace(/\n/g, '<br>')}</p><p><a href="${esc(appUrl() + a.link)}">Open in ShiftReady</a></p>`;
    await sendMany(list.filter((p) => p.email && p.client_email_alerts), (p) =>
      sendEmail({ to: p.email, subject: e.subject, text: `${e.text}\n\nOpen in ShiftReady: ${appUrl()}${a.link}`, html, tag: 'office-alert', stream: clientStream() }));
  }
}

type ReqInfo = { request_date: string; start_time: string; end_time: string; headcount: number; is_urgent?: boolean };

/** "Steve Jones at DHL added a new shift for 6 people, tomorrow (Wed 4 Nov), 14:00 to 22:00, Bradford site." */
export function requestSentence(who: string, client: string, verb: string, r: ReqInfo, site: string) {
  const people = `${r.headcount} ${r.headcount === 1 ? 'person' : 'people'}`;
  return `${who} at ${client} ${verb} for ${people}, ${whenWord(r.request_date)}, ${hhmm(r.start_time)} to ${hhmm(r.end_time)}, ${site} site.`;
}

// ---------- Emails to the client ----------

/** People at the client who should hear about a request: whoever posted it, or everyone who looks after that site. */
async function requestContacts(db: SupabaseClient, req: { client_id: string; site_id: string; created_by: string | null }) {
  if (req.created_by) {
    const { data } = await db.from('client_users').select('id,email,full_name,mobile,status').eq('id', req.created_by).maybeSingle();
    if (data && data.status !== 'removed') return [data];
  }
  const { data: users } = await db.from('client_users').select('id,email,full_name,mobile,status,all_sites,client_user_sites(site_id)').eq('client_id', req.client_id).eq('status', 'active');
  return (users ?? []).filter((u) => u.all_sites || ((u.client_user_sites ?? []) as { site_id: string }[]).some((x) => x.site_id === req.site_id));
}

/**
 * Call after anyone is booked onto, taken off, or confirms a shift. If the shift came from a client request it
 * tells the client (email and text) once every place is filled by people who have confirmed they're coming,
 * and emails them if a confirmed person is taken off. People still waiting to confirm don't count.
 */
export async function afterBookingChange(db: SupabaseClient, shiftId: string, removed?: { first: string; last: string }) {
  const { data: s } = await db.from('shifts').select('id,request_id,status').eq('id', shiftId).maybeSingle();
  if (!s?.request_id || s.status === 'cancelled') return;
  const { data: r } = await db.from('client_requests')
    .select('id,client_id,site_id,created_by,request_date,start_time,end_time,headcount,status,filled_notified_at,clients(name,is_test),client_sites(name)')
    .eq('id', s.request_id).maybeSingle();
  if (!r || r.status === 'cancelled' || hasStarted(r)) return;
  const { count } = await db.from('offers').select('id', { count: 'exact', head: true }).eq('shift_id', s.id).eq('status', 'accepted').eq('awaiting_confirm', false);
  const filled = count ?? 0;
  const site = (r.client_sites as unknown as { name: string } | null)?.name ?? '';
  const when = `${whenWord(r.request_date)}, ${hhmm(r.start_time)} to ${hhmm(r.end_time)}`;
  const link = `${appUrl()}/portal/requests/${r.id}`;
  const contacts = await requestContacts(db, r);

  if (removed) {
    await sendMany(contacts, (c) => sendEmail({
      to: c.email, stream: clientStream(), tag: 'client-removed',
      subject: `Change to your ${site} shift ${whenWord(r.request_date)}`,
      text: `Hi ${(c.full_name || '').split(' ')[0] || 'there'},\n\n${removed.first} ${removed.last} is no longer booked on your ${site} shift ${when}. We're finding a replacement and the portal will update as soon as someone is confirmed.\n\nNow booked: ${filled} of ${r.headcount}.\n\nSee the shift: ${link}\n\nStaff Selection UK`,
    }));
  }
  if (filled >= r.headcount && !r.filled_notified_at) {
    await db.from('client_requests').update({ filled_notified_at: new Date().toISOString() }).eq('id', r.id);
    await sendMany(contacts, (c) => sendEmail({
      to: c.email, stream: clientStream(), tag: 'client-filled',
      subject: `Fully booked: ${site} ${whenWord(r.request_date)}`,
      text: `Hi ${(c.full_name || '').split(' ')[0] || 'there'},\n\nAll ${r.headcount} places on your ${site} shift ${when} are now filled. You can see who's coming, and who needs an induction, here:\n${link}\n\nStaff Selection UK`,
    }));
    // And a text to their mobile.
    await sendMany(contacts.filter((c) => c.mobile), (c) => sendSms({
      db, to: c.mobile!, kind: 'client_filled',
      body: `ShiftReady: your ${site} shift ${when} is fully booked, ${r.headcount} of ${r.headcount} confirmed. See who's coming: ${link} - Staff Selection`,
    }));
  } else if (filled < r.headcount && r.filled_notified_at) {
    // Someone dropped off after it was full: email again when it's full again.
    await db.from('client_requests').update({ filled_notified_at: null }).eq('id', r.id);
  }
}

// ---------- Ratings ----------

export type TempScore = { client: number | null; clientCount: number; overall: number | null; overallCount: number; blocked: boolean };

/** Average star ratings for these temps: from this client, and from every client. Plus whether this client blocked them. */
export async function scoresFor(db: SupabaseClient, tempIds: string[], clientId: string | null) {
  const out = new Map<string, TempScore>();
  if (!tempIds.length) return out;
  const ids = [...new Set(tempIds)];
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300);
    const [{ data: fb }, { data: blocks }] = await Promise.all([
      db.from('client_feedback').select('temp_id,client_id,stars').in('temp_id', chunk).not('stars', 'is', null),
      clientId ? db.from('client_blocks').select('temp_id').eq('client_id', clientId).is('lifted_at', null).in('temp_id', chunk) : Promise.resolve({ data: [] as { temp_id: string }[] }),
    ]);
    for (const id of chunk) {
      const all = (fb ?? []).filter((f) => f.temp_id === id);
      const mine = all.filter((f) => f.client_id === clientId);
      const avg = (xs: { stars: number | null }[]) => (xs.length ? xs.reduce((n, x) => n + (x.stars ?? 0), 0) / xs.length : null);
      out.set(id, { client: avg(mine), clientCount: mine.length, overall: avg(all), overallCount: all.length, blocked: (blocks ?? []).some((b) => b.temp_id === id) });
    }
  }
  return out;
}

/** Sort: this client's rating first, then overall rating, then whatever order they came in (e.g. distance). Unrated go after rated. */
export function byScore(scores: Map<string, TempScore>) {
  const k = (v: number | null) => (v == null ? -1 : v);
  return (a: { temp_id: string }, b: { temp_id: string }) => {
    const x = scores.get(a.temp_id), y = scores.get(b.temp_id);
    return k(y?.client ?? null) - k(x?.client ?? null) || k(y?.overall ?? null) - k(x?.overall ?? null);
  };
}

/** Temps this client has blocked (still in force). */
export async function blockedFor(db: SupabaseClient, clientId: string | null) {
  if (!clientId) return new Set<string>();
  const { data } = await db.from('client_blocks').select('temp_id').eq('client_id', clientId).is('lifted_at', null);
  return new Set((data ?? []).map((b) => b.temp_id));
}
