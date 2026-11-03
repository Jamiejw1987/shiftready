'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireClient, userName } from '@/lib/portalAuth';
import { clientAudit, hoursUntil, hasStarted, notifyStaff, requestSentence, sendClientLink, today, whenWord } from '@/lib/clients';
import { JOB_TYPES, hhmm } from '@/lib/format';
import { toE164 } from '@/lib/phone';

type Result = { ok: boolean; error?: string; message?: string; id?: string };
const TIME = /^\d{2}:\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const clean = (s: string | null | undefined, max = 500) => (s ?? '').trim().slice(0, max) || null;
const plusDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);

// ---------- Signing in ----------

/** Emails a sign-in link. Always says the same thing, so nobody can find out who has access by trying emails. */
export async function requestLink(emailIn: string): Promise<Result> {
  const email = (emailIn || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Enter the email address Staff Selection set you up with.' };
  const db = createAdminClient();
  const { data: cu } = await db.from('client_users').select('id,client_id,email,full_name,status,clients(name,active)').eq('email', email).maybeSingle();
  const client = cu?.clients as unknown as { name: string; active: boolean } | null;
  if (cu && cu.status !== 'removed' && client?.active) {
    // At most one link every 2 minutes per person.
    const since = new Date(Date.now() - 2 * 60e3).toISOString();
    const { count } = await db.from('audit_log').select('id', { count: 'exact', head: true }).eq('client_user_id', cu.id).eq('action', 'client.link_requested').gte('created_at', since);
    if (!count) {
      const r = await sendClientLink(db, cu, client.name, false);
      await clientAudit(db, { action: 'client.link_requested', detail: `${userName(cu)} asked for a sign-in link${r.ok ? '' : ` (failed: ${r.error})`}`, clientId: cu.client_id, clientUserId: cu.id, entity: 'client_user', entityId: cu.id });
    }
  }
  return { ok: true };
}

export async function signOutPortal() {
  await createClient().auth.signOut();
  redirect('/portal/login?out=1');
}

// ---------- Your details ----------

export async function saveProfile(input: { fullName: string; mobile: string; jobTitle: string; siteIds: string[] | null }): Promise<Result> {
  const { db, user, client, sites } = await requireClient({ allowIncomplete: true });
  const fullName = clean(input.fullName, 80), jobTitle = clean(input.jobTitle, 80);
  const mobile = toE164(input.mobile);
  if (!fullName || fullName.split(/\s+/).length < 2) return { ok: false, error: 'Enter your first name and surname.' };
  if (!mobile) return { ok: false, error: 'Enter a UK mobile number starting 07.' };
  if (!jobTitle) return { ok: false, error: 'Enter your job title.' };
  const before = { full_name: user.full_name, mobile: user.mobile, job_title: user.job_title };
  await db.from('client_users').update({ full_name: fullName, mobile, job_title: jobTitle }).eq('id', user.id);

  // Which sites they look after: only ever narrowing what the office gave them.
  if (input.siteIds && sites.length > 1) {
    const chosen = input.siteIds.filter((id) => sites.some((s) => s.id === id));
    if (!chosen.length) return { ok: false, error: 'Choose at least one site.' };
    if (chosen.length < sites.length || !user.all_sites) {
      await db.from('client_user_sites').delete().eq('client_user_id', user.id);
      await db.from('client_user_sites').insert(chosen.map((site_id) => ({ client_user_id: user.id, site_id })));
      await db.from('client_users').update({ all_sites: false }).eq('id', user.id);
    }
  }
  await clientAudit(db, {
    action: user.full_name ? 'client.profile_updated' : 'client.joined', clientId: client.id, clientUserId: user.id, entity: 'client_user', entityId: user.id,
    detail: user.full_name ? `${fullName} (${client.name}) updated their details` : `${fullName} (${jobTitle}) joined the ${client.name} portal`,
    before, after: { full_name: fullName, mobile, job_title: jobTitle },
  });
  if (!user.full_name) {
    await notifyStaff(db, { kind: 'client_joined', title: `${fullName} at ${client.name} has signed in to the portal`, body: `${jobTitle}. Their details are on the ${client.name} page.`, link: `/clients/${client.id}`, clientId: client.id });
  }
  revalidatePath('/portal', 'layout');
  return { ok: true };
}

// ---------- Shift requests ----------

export type RequestInput = {
  siteId: string; dates: string[]; start: string; end: string; role: string; headcount: number; notes: string;
  templateId?: string | null; saveAs?: string | null;
};

function checkShape(i: { start: string; end: string; role: string; headcount: number }) {
  if (!TIME.test(i.start) || !TIME.test(i.end)) return 'Choose a start and finish time.';
  if (i.start === i.end) return 'The start and finish times are the same.';
  if (!(JOB_TYPES as readonly string[]).includes(i.role)) return 'Choose the type of work.';
  if (!(Number.isInteger(i.headcount) && i.headcount >= 1 && i.headcount <= 200)) return 'How many people? Between 1 and 200.';
  return '';
}

export async function createRequests(input: RequestInput): Promise<Result> {
  const { db, user, client, sites } = await requireClient();
  const site = sites.find((s) => s.id === input.siteId);
  if (!site) return { ok: false, error: 'Choose a site.' };
  const problem = checkShape(input);
  if (problem) return { ok: false, error: problem };
  const t = today();
  const dates = [...new Set(input.dates.filter((d) => DATE.test(d)))].sort();
  if (!dates.length) return { ok: false, error: 'Choose a date.' };
  if (dates.length > 14) return { ok: false, error: 'Choose up to 14 dates at a time.' };
  if (dates[0] < t || dates[dates.length - 1] > plusDays(t, 120)) return { ok: false, error: 'Dates must be from today up to four months ahead.' };
  const rows = dates.map((d) => ({ request_date: d, start_time: input.start, end_time: input.end }));
  if (rows.some((r) => hoursUntil(r) <= 0)) return { ok: false, error: 'That start time has already passed. Call us for anything starting now.' };

  let templateId = input.templateId && (await db.from('client_templates').select('id').eq('id', input.templateId).eq('client_id', client.id).maybeSingle()).data?.id || null;
  const saveAs = clean(input.saveAs, 60);
  if (saveAs) {
    const { data: tpl } = await db.from('client_templates').insert({
      client_id: client.id, site_id: site.id, name: saveAs, start_time: input.start, end_time: input.end, role: input.role, headcount: input.headcount, notes: clean(input.notes), created_by: user.id,
    }).select('id').single();
    templateId = tpl?.id ?? templateId;
  }

  const notes = clean(input.notes);
  const { data: made, error } = await db.from('client_requests').insert(rows.map((r) => ({
    client_id: client.id, site_id: site.id, created_by: user.id, ...r, role: input.role, headcount: input.headcount, notes,
    is_urgent: hoursUntil(r) < client.cutoff_hours, template_id: templateId,
  }))).select('id,request_date,start_time,end_time,headcount,is_urgent').order('request_date');
  if (error || !made?.length) return { ok: false, error: 'Couldn’t send your request. Please try again.' };

  const who = userName(user);
  const urgent = made.some((m) => m.is_urgent);
  for (const m of made) {
    await clientAudit(db, {
      action: 'request.posted', clientId: client.id, clientUserId: user.id, entity: 'request', entityId: m.id,
      detail: `${who} (${client.name}) requested ${m.headcount} × ${input.role}, ${site.name}, ${whenWord(m.request_date)} ${input.start}-${input.end}${m.is_urgent ? ' (urgent)' : ''}`,
      after: { date: m.request_date, start: input.start, end: input.end, role: input.role, headcount: input.headcount, notes, site: site.name },
    });
  }
  const sentence = made.length === 1
    ? requestSentence(who, client.name, 'added a new shift', made[0], site.name)
    : `${who} at ${client.name} added ${made.length} new shifts for ${input.headcount} ${input.headcount === 1 ? 'person' : 'people'} (${made.map((m) => whenWord(m.request_date).replace(/ \(.*\)/, '')).join(', ')}), ${input.start} to ${input.end}, ${site.name} site.`;
  await notifyStaff(db, {
    kind: 'request_new', urgent, clientId: client.id, requestId: made.length === 1 ? made[0].id : null,
    title: sentence, body: `${input.role}${notes ? `. Notes: ${notes}` : ''}`,
    link: made.length === 1 ? `/client-requests/${made[0].id}` : '/client-requests',
    sms: `ShiftReady: ${urgent ? 'URGENT: ' : ''}${sentence}`,
    email: { subject: `${urgent ? 'URGENT: ' : ''}New shift request from ${client.name}`, text: `${sentence}\n\nType of work: ${input.role}${notes ? `\nNotes: ${notes}` : ''}` },
  });
  revalidatePath('/portal');
  return { ok: true, id: made.length === 1 ? made[0].id : undefined, message: made.length === 1 ? 'Request sent.' : `${made.length} requests sent.` };
}

async function loadMine(requestId: string) {
  const ctx = await requireClient();
  const { data: r } = await ctx.db.from('client_requests').select('*,client_sites(name)').eq('id', requestId).eq('client_id', ctx.client.id).maybeSingle();
  if (!r || !ctx.sites.some((s) => s.id === r.site_id)) return { ...ctx, r: null, shift: null };
  const { data: shift } = await ctx.db.from('shifts').select('id,heads,status').eq('request_id', r.id).neq('status', 'cancelled').maybeSingle();
  return { ...ctx, r: r as typeof r & { client_sites: { name: string } | null }, shift };
}

export async function updateRequest(requestId: string, input: { date: string; start: string; end: string; role: string; headcount: number; notes: string }): Promise<Result> {
  const { db, user, client, r, shift } = await loadMine(requestId);
  if (!r) return { ok: false, error: 'Request not found.' };
  if (r.status === 'cancelled') return { ok: false, error: 'This request was cancelled.' };
  if (hasStarted(r)) return { ok: false, error: 'This shift has started, so it can’t be changed here. Please call us.' };
  const problem = checkShape(input);
  if (problem) return { ok: false, error: problem };
  const notes = clean(input.notes);
  const lateWindow = hoursUntil(r) < client.cutoff_hours;

  let booked = 0;
  if (shift) {
    const { count } = await db.from('offers').select('id', { count: 'exact', head: true }).eq('shift_id', shift.id).eq('status', 'accepted');
    booked = count ?? 0;
    if (input.date !== r.request_date || input.start !== hhmm(r.start_time) || input.end !== hhmm(r.end_time) || input.role !== r.role)
      return { ok: false, error: 'We’re already booking people for this shift, so the date, times and type of work can’t be changed here. Cancel it and post a new one, or call us.' };
    if (input.headcount < booked) return { ok: false, error: `${booked} ${booked === 1 ? 'person is' : 'people are'} already booked. Call us if you need fewer.` };
  }
  if (lateWindow && input.headcount < r.headcount) return { ok: false, error: `This shift starts in less than ${client.cutoff_hours} hours, so please call us to reduce the numbers.` };
  if (!DATE.test(input.date) || input.date < today()) return { ok: false, error: 'Choose a date from today onwards.' };
  const next = { request_date: input.date, start_time: input.start, end_time: input.end };
  if (hoursUntil(next) <= 0) return { ok: false, error: 'That start time has already passed.' };

  const before = { date: r.request_date, start: hhmm(r.start_time), end: hhmm(r.end_time), role: r.role, headcount: r.headcount, notes: r.notes };
  const after = { date: input.date, start: input.start, end: input.end, role: input.role, headcount: input.headcount, notes };
  const changed = (Object.keys(after) as (keyof typeof after)[]).filter((k) => before[k] !== after[k]);
  if (!changed.length) return { ok: false, error: 'Nothing has changed.' };
  await db.from('client_requests').update({
    ...next, role: input.role, headcount: input.headcount, notes, updated_at: new Date().toISOString(),
    is_urgent: r.is_urgent || hoursUntil(next) < client.cutoff_hours,
    ...(input.headcount > r.headcount ? { filled_notified_at: null } : {}),
  }).eq('id', r.id);
  if (shift && input.headcount !== shift.heads) {
    await db.from('shifts').update({ heads: input.headcount, status: booked >= input.headcount ? 'filled' : 'open' }).eq('id', shift.id);
  }
  const who = userName(user);
  const site = r.client_sites?.name ?? '';
  const words: Record<string, string> = { date: 'date', start: 'start', end: 'finish', role: 'type of work', headcount: 'number of people', notes: 'notes' };
  const what = changed.map((k) => (k === 'notes' ? 'notes' : `${words[k]} ${before[k]} → ${after[k]}`)).join(', ');
  await clientAudit(db, { action: 'request.edited', clientId: client.id, clientUserId: user.id, entity: 'request', entityId: r.id, detail: `${who} (${client.name}) changed a ${site} shift: ${what}`, before, after });
  const big = changed.some((k) => ['date', 'start', 'end', 'headcount'].includes(k));
  const sentence = requestSentence(who, client.name, 'changed a shift', { ...next, headcount: input.headcount }, site);
  await notifyStaff(db, {
    kind: 'request_edited', clientId: client.id, requestId: r.id, urgent: hoursUntil(next) < client.cutoff_hours,
    title: `${sentence.replace(/\.$/, '')} (${what})`, link: `/client-requests/${r.id}`,
    ...(big ? {
      sms: `ShiftReady: ${hoursUntil(next) < client.cutoff_hours ? 'URGENT: ' : ''}${sentence.replace(/\.$/, '')}. Changed: ${what}.`,
      email: { subject: `Shift changed by ${client.name}`, text: `${sentence}\n\nWhat changed: ${what}${shift ? `\n\nThis shift is already being filled (${booked} booked). Check the board.` : ''}` },
    } : {}),
  });
  revalidatePath(`/portal/requests/${r.id}`);
  revalidatePath('/portal');
  return { ok: true, message: 'Saved. We’ve let the team know.' };
}

export async function cancelRequest(requestId: string, reason: string): Promise<Result> {
  const { db, user, client, r, shift } = await loadMine(requestId);
  if (!r) return { ok: false, error: 'Request not found.' };
  if (r.status === 'cancelled') return { ok: false, error: 'Already cancelled.' };
  if (hasStarted(r)) return { ok: false, error: 'This shift has started. Please call us.' };
  if (hoursUntil(r) < client.cutoff_hours) return { ok: false, error: `This shift starts in less than ${client.cutoff_hours} hours, so please call us to cancel it.` };
  const why = clean(reason, 300);
  await db.from('client_requests').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by_client: true, cancel_reason: why, updated_at: new Date().toISOString() }).eq('id', r.id);
  const who = userName(user);
  const site = r.client_sites?.name ?? '';
  const sentence = requestSentence(who, client.name, 'cancelled the shift', r, site);
  await clientAudit(db, { action: 'request.cancelled', clientId: client.id, clientUserId: user.id, entity: 'request', entityId: r.id, detail: `${sentence}${why ? ` Reason: ${why}` : ''}`, before: { status: r.status }, after: { status: 'cancelled', reason: why } });
  await notifyStaff(db, {
    kind: 'request_cancelled', clientId: client.id, requestId: r.id, urgent: !!shift,
    title: sentence, body: shift ? 'People may already be booked: open the shift and cancel it so they get a text.' : why ?? undefined,
    link: shift ? `/shifts/${shift.id}` : `/client-requests/${r.id}`,
    sms: `ShiftReady: ${sentence}${shift ? ' Open the shift and cancel it so booked temps are told.' : ''}`,
    email: { subject: `Shift cancelled by ${client.name}`, text: `${sentence}${why ? `\n\nReason: ${why}` : ''}${shift ? '\n\nThis shift was already being filled. Open it in ShiftReady and cancel it so booked temps get a text.' : ''}` },
  });
  revalidatePath('/portal');
  revalidatePath(`/portal/requests/${r.id}`);
  return { ok: true, message: 'Cancelled. We’ve let the team know.' };
}

export async function deleteTemplate(id: string): Promise<Result> {
  const { db, user, client } = await requireClient();
  const { data: t } = await db.from('client_templates').select('id,name').eq('id', id).eq('client_id', client.id).maybeSingle();
  if (!t) return { ok: false, error: 'Not found.' };
  await db.from('client_templates').delete().eq('id', id);
  await clientAudit(db, { action: 'template.deleted', clientId: client.id, clientUserId: user.id, entity: 'template', entityId: id, detail: `${userName(user)} (${client.name}) deleted the saved shift "${t.name}"` });
  revalidatePath('/portal/account');
  revalidatePath('/portal/new');
  return { ok: true };
}

// ---------- Attendance and ratings ----------

async function loadPerson(requestId: string, offerId: string) {
  const ctx = await loadMine(requestId);
  if (!ctx.r || !ctx.shift) return { ...ctx, o: null };
  const { data: o } = await ctx.db.from('offers').select('id,temp_id,status,temps(first_name,last_name)').eq('id', offerId).eq('shift_id', ctx.shift.id).in('status', ['accepted', 'noshow']).maybeSingle();
  return { ...ctx, o };
}

export async function markAttendance(requestId: string, offerId: string, attended: boolean): Promise<Result> {
  const { db, user, client, r, shift, o } = await loadPerson(requestId, offerId);
  if (!r || !o || !shift) return { ok: false, error: 'Not found. Refresh the page.' };
  if (!hasStarted(r)) return { ok: false, error: 'You can mark attendance once the shift has started.' };
  const t = o.temps as unknown as { first_name: string; last_name: string };
  const { data: prev } = await db.from('client_feedback').select('attended,stars').eq('offer_id', o.id).maybeSingle();
  const now = new Date().toISOString();
  await db.from('client_feedback').upsert({
    offer_id: o.id, client_id: client.id, temp_id: o.temp_id, request_id: r.id, attended, marked_by: user.id, marked_at: now, updated_at: now,
    ...(attended ? {} : { stars: null, return_to_site: null, rated_by: null, rated_at: null }),
  }, { onConflict: 'offer_id' });
  const site = r.client_sites?.name ?? '';
  await clientAudit(db, {
    action: attended ? 'attendance.attended' : 'attendance.noshow', clientId: client.id, clientUserId: user.id, entity: 'request', entityId: r.id,
    detail: `${userName(user)} (${client.name}) marked ${t.first_name} ${t.last_name} as ${attended ? 'attended' : 'a no-show'}, ${site} ${whenWord(r.request_date)}`,
    before: prev ?? null, after: { attended },
  });
  if (!attended && prev?.attended !== false) {
    await notifyStaff(db, {
      kind: 'client_noshow', clientId: client.id, requestId: r.id, link: `/shifts/${shift.id}`,
      title: `${client.name} marked ${t.first_name} ${t.last_name} as a no-show (${site}, ${whenWord(r.request_date)})`,
      body: 'Check with the temp. Use Mark no-show on the shift if it stands, so it goes on their record and they get a text.',
    });
  }
  revalidatePath(`/portal/requests/${r.id}`);
  return { ok: true };
}

export async function rateTemp(requestId: string, offerId: string, stars: number, returnToSite: boolean | null, comment: string): Promise<Result> {
  const { db, user, client, r, shift, o } = await loadPerson(requestId, offerId);
  if (!r || !o || !shift) return { ok: false, error: 'Not found. Refresh the page.' };
  if (!hasStarted(r)) return { ok: false, error: 'You can rate people once the shift has started.' };
  if (!(Number.isInteger(stars) && stars >= 1 && stars <= 5)) return { ok: false, error: 'Choose 1 to 5 stars.' };
  const low = stars <= 2;
  if (low && returnToSite == null) return { ok: false, error: 'Let us know if you want this person back on site.' };
  const t = o.temps as unknown as { first_name: string; last_name: string };
  const { data: prev } = await db.from('client_feedback').select('attended,stars,return_to_site,comment').eq('offer_id', o.id).maybeSingle();
  const now = new Date().toISOString();
  const note = clean(comment, 500);
  await db.from('client_feedback').upsert({
    offer_id: o.id, client_id: client.id, temp_id: o.temp_id, request_id: r.id, attended: true,
    ...(prev?.attended == null ? { marked_by: user.id, marked_at: now } : {}),
    stars, return_to_site: low ? returnToSite : null, comment: note, rated_by: user.id, rated_at: now, updated_at: now,
  }, { onConflict: 'offer_id' });
  const site = r.client_sites?.name ?? '';
  const name = `${t.first_name} ${t.last_name}`;
  await clientAudit(db, {
    action: 'rating.given', clientId: client.id, clientUserId: user.id, entity: 'request', entityId: r.id,
    detail: `${userName(user)} (${client.name}) rated ${name} ${stars} star${stars === 1 ? '' : 's'}${low ? (returnToSite ? ', happy for them to return' : ', does not want them back') : ''}${note ? `: "${note}"` : ''}`,
    before: prev ?? null, after: { stars, return_to_site: low ? returnToSite : null, comment: note },
  });

  if (low && returnToSite === false) {
    const { data: live } = await db.from('client_blocks').select('id').eq('client_id', client.id).eq('temp_id', o.temp_id).is('lifted_at', null).maybeSingle();
    if (!live) {
      await db.from('client_blocks').insert({ client_id: client.id, temp_id: o.temp_id, offer_id: o.id, reason: note, created_by: user.id });
      await clientAudit(db, { action: 'temp.blocked_by_client', clientId: client.id, clientUserId: user.id, entity: 'temp', entityId: o.temp_id, detail: `${userName(user)} (${client.name}) asked for ${name} not to return (${stars} star${stars === 1 ? '' : 's'})${note ? `: "${note}"` : ''}` });
      const { data: ahead } = await db.from('offers').select('id,shifts!inner(id,shift_date,client_id,status)').eq('temp_id', o.temp_id).eq('status', 'accepted')
        .eq('shifts.client_id', client.id).gte('shifts.shift_date', today()).neq('shifts.status', 'cancelled');
      await notifyStaff(db, {
        kind: 'client_block', clientId: client.id, requestId: r.id, link: `/temps/${o.temp_id}`, urgent: !!ahead?.length,
        title: `${client.name} doesn’t want ${name} back on site (${stars} star${stars === 1 ? '' : 's'})`,
        body: `${note ? `“${note}”. ` : ''}They’re now kept off ${client.name} shifts.${ahead?.length ? ` They’re still booked on ${ahead.length} upcoming ${client.name} shift${ahead.length === 1 ? '' : 's'}: take them off and call them.` : ''}`,
      });
    }
  }
  revalidatePath(`/portal/requests/${r.id}`);
  return { ok: true };
}
