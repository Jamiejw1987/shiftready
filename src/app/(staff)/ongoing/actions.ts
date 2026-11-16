'use server';
import { revalidatePath } from 'next/cache';
import { requireStaff, audit } from '@/lib/auth';

type Result = { ok: boolean; error?: string; message?: string };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const todayUK = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const NEEDS_SQL = 'Run supabase/2026-11-16-ongoing-workers.sql in Supabase first.';
const missingTable = (e: { message?: string; code?: string } | null) => !!e && (e.code === '42P01' || e.code === '42703' || /client_workers|no_comms/.test(e.message ?? ''));

function refresh(tempId: string, clientId?: string | null) {
  revalidatePath(`/temps/${tempId}`);
  revalidatePath('/temps');
  if (clientId) revalidatePath(`/clients/${clientId}`);
}

/** The "No messages" switch on a worker. Off = they get nothing from ShiftReady: no offers, reminders, links or texts. */
export async function setMessagesOff(tempId: string, off: boolean): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const { data: t, error: e } = await supabase.from('temps').select('id,first_name,last_name,no_comms').eq('id', tempId).maybeSingle();
  if (missingTable(e)) return { ok: false, error: NEEDS_SQL };
  if (!t) return { ok: false, error: 'Worker not found.' };
  const { error } = await supabase.from('temps').update(off
    ? { no_comms: true, no_comms_reason: 'manual', no_comms_at: new Date().toISOString(), no_comms_by: profile.id }
    : { no_comms: false, no_comms_reason: null, no_comms_at: new Date().toISOString(), no_comms_by: profile.id }).eq('id', tempId);
  if (error) return { ok: false, error: missingTable(error) ? NEEDS_SQL : 'Couldn’t save. Try again.' };
  await audit(supabase, profile.id, off ? 'temp.messages_off' : 'temp.messages_on', `${off ? 'Switched off' : 'Switched back on'} all messages to ${t.first_name} ${t.last_name}`);
  refresh(tempId);
  return { ok: true, message: off ? `Messages off. ${t.first_name} won’t get any texts, offers or emails from ShiftReady.` : `Messages back on for ${t.first_name}. They’ll get texts again (shift offers only once they’ve opted in and are Active).` };
}

/** Puts a worker on an ongoing assignment at a client and switches their messages off. No end date needed. */
export async function addOngoing(input: { tempId: string; clientId: string; siteId?: string | null; startDate?: string; jobTitle?: string; notes?: string }): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const start = input.startDate && DATE.test(input.startDate) ? input.startDate : todayUK();
  const [{ data: t }, { data: c }] = await Promise.all([
    supabase.from('temps').select('id,first_name,last_name').eq('id', input.tempId).maybeSingle(),
    supabase.from('clients').select('id,name').eq('id', input.clientId).maybeSingle(),
  ]);
  if (!t) return { ok: false, error: 'Worker not found.' };
  if (!c) return { ok: false, error: 'Pick a client.' };
  let siteId: string | null = null;
  if (input.siteId) {
    const { data: s } = await supabase.from('client_sites').select('id').eq('id', input.siteId).eq('client_id', c.id).maybeSingle();
    siteId = s?.id ?? null;
  }
  const { error } = await supabase.from('client_workers').insert({
    client_id: c.id, site_id: siteId, temp_id: t.id, start_date: start,
    job_title: input.jobTitle?.trim().slice(0, 80) || null, notes: input.notes?.trim().slice(0, 500) || null, added_by: profile.id,
  });
  if (error) {
    if (missingTable(error)) return { ok: false, error: NEEDS_SQL };
    return { ok: false, error: error.code === '23505' ? `${t.first_name} is already down as ongoing at ${c.name}.` : 'Couldn’t save. Try again.' };
  }
  await supabase.from('temps').update({ no_comms: true, no_comms_reason: 'ongoing', no_comms_at: new Date().toISOString(), no_comms_by: profile.id }).eq('id', t.id);
  await audit(supabase, profile.id, 'temp.ongoing_added', `Put ${t.first_name} ${t.last_name} down as an ongoing worker at ${c.name} from ${start}. Messages switched off.`);
  refresh(t.id, c.id);
  return { ok: true, message: `${t.first_name} ${t.last_name} is now ongoing at ${c.name}. Their messages are off.` };
}

/** Ends an ongoing assignment. Messages stay off unless you tick to switch them back on. */
export async function endOngoing(id: string, input: { endDate?: string; messagesBackOn?: boolean }): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const { data: a } = await supabase.from('client_workers').select('id,temp_id,client_id,start_date,end_date,clients(name),temps(first_name,last_name)').eq('id', id).maybeSingle();
  if (!a) return { ok: false, error: 'Not found.' };
  if (a.end_date) return { ok: false, error: 'That has already ended.' };
  const end = input.endDate && DATE.test(input.endDate) ? input.endDate : todayUK();
  if (end < a.start_date) return { ok: false, error: 'The end date can’t be before they started.' };
  const { error } = await supabase.from('client_workers').update({ end_date: end, ended_by: profile.id }).eq('id', id);
  if (error) return { ok: false, error: 'Couldn’t save. Try again.' };
  const c = a.clients as unknown as { name: string }, t = a.temps as unknown as { first_name: string; last_name: string };
  let back = false;
  if (input.messagesBackOn) {
    const { count } = await supabase.from('client_workers').select('id', { count: 'exact', head: true }).eq('temp_id', a.temp_id).is('end_date', null);
    if (!count) {
      await supabase.from('temps').update({ no_comms: false, no_comms_reason: null, no_comms_at: new Date().toISOString(), no_comms_by: profile.id }).eq('id', a.temp_id);
      back = true;
    }
  }
  await audit(supabase, profile.id, 'temp.ongoing_ended', `Ended ${t.first_name} ${t.last_name}'s ongoing work at ${c.name} on ${end}${back ? '. Messages switched back on' : ''}`);
  refresh(a.temp_id, a.client_id);
  return { ok: true, message: `Ended at ${c.name}.${back ? ' Messages are back on.' : input.messagesBackOn ? ' Messages stay off: they’re still ongoing somewhere else.' : ''}` };
}

/** Finds workers by name or mobile, for adding them to a client as ongoing. */
export async function findWorkers(q: string) {
  const { supabase } = await requireStaff();
  const words = q.trim().replace(/[%_,()]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 3);
  if (!words.length) return [];
  const digits = q.replace(/\D/g, '');
  let query = supabase.from('temps').select('id,first_name,last_name,mobile,postcode,status').limit(10);
  if (digits.length >= 5) query = query.like('mobile', `%${digits.replace(/^0/, '').replace(/^44/, '')}%`);
  else for (const w of words) query = query.or(`first_name.ilike.%${w}%,last_name.ilike.%${w}%`);
  const { data } = await query.order('first_name');
  return data ?? [];
}
