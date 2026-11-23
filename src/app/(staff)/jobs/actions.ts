'use server';
import { revalidatePath } from 'next/cache';
import { requireStaff, audit } from '@/lib/auth';
import { displayMobile } from '@/lib/phone';

type Result = { ok: boolean; error?: string; message?: string; id?: string };
export type JobInput = {
  clientId: string; clientName: string; role: string; heads: string; payRate: string; chargeRate: string;
  shiftPattern: string; startDate: string; location: string; requirements: string; notes: string;
};
const SETUP = 'Couldn’t save. Has supabase/2026-11-23-jobs.sql been run in Supabase?';
const t = (s: string, n = 200) => s.trim().slice(0, n) || null;
const money = (s: string) => { const v = parseFloat(s.replace(/[£,\s]/g, '')); return Number.isFinite(v) && v >= 0 && v < 1000 ? Math.round(v * 100) / 100 : null; };

export async function saveJob(id: string | null, j: JobInput): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  let clientName = j.clientName.trim();
  if (j.clientId) {
    const { data: c } = await supabase.from('clients').select('name').eq('id', j.clientId).maybeSingle();
    if (c) clientName = c.name;
  }
  if (!clientName) return { ok: false, error: 'Pick or type the client.' };
  if (!j.role.trim()) return { ok: false, error: 'Say what they need, e.g. Warehouse Operative.' };
  const heads = parseInt(j.heads, 10);
  if (!(heads > 0 && heads <= 1000)) return { ok: false, error: 'How many people do they need?' };
  const row = {
    client_id: j.clientId || null, client_name: clientName.slice(0, 120), role: j.role.trim().slice(0, 120), heads,
    pay_rate: money(j.payRate), charge_rate: profile.role === 'admin' ? money(j.chargeRate) : undefined,
    shift_pattern: t(j.shiftPattern), start_date: /^\d{4}-\d{2}-\d{2}$/.test(j.startDate) ? j.startDate : null,
    location: t(j.location, 120), requirements: t(j.requirements, 500), notes: t(j.notes, 1000), updated_at: new Date().toISOString(),
  };
  if (id) {
    const { error } = await supabase.from('jobs').update(row).eq('id', id);
    if (error) return { ok: false, error: SETUP };
    await audit(supabase, profile.id, 'job.updated', `Updated job: ${row.heads} x ${row.role} for ${row.client_name}`);
    revalidatePath('/jobs'); revalidatePath(`/jobs/${id}`);
    return { ok: true, message: 'Saved.', id };
  }
  const { data, error } = await supabase.from('jobs').insert({ ...row, created_by: profile.id }).select('id').single();
  if (error || !data) return { ok: false, error: SETUP };
  await audit(supabase, profile.id, 'job.created', `Added job: ${row.heads} x ${row.role} for ${row.client_name}`);
  revalidatePath('/jobs');
  return { ok: true, message: 'Job added.', id: data.id };
}

export async function setJobStatus(id: string, status: 'open' | 'filled' | 'closed'): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const { data: j } = await supabase.from('jobs').select('client_name,role').eq('id', id).maybeSingle();
  if (!j) return { ok: false, error: 'Not found.' };
  await supabase.from('jobs').update({ status, filled_at: status === 'filled' ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq('id', id);
  await audit(supabase, profile.id, `job.${status}`, `${status === 'open' ? 'Reopened' : status === 'filled' ? 'Marked filled' : 'Closed'} job: ${j.role} for ${j.client_name}`);
  revalidatePath('/jobs'); revalidatePath(`/jobs/${id}`);
  return { ok: true, message: status === 'open' ? 'Reopened.' : status === 'filled' ? 'Marked as filled.' : 'Closed.' };
}

export async function deleteJob(id: string): Promise<Result> {
  const { supabase, profile } = await requireStaff({ admin: true });
  const { data: j } = await supabase.from('jobs').select('client_name,role').eq('id', id).maybeSingle();
  if (!j) return { ok: false, error: 'Not found.' };
  await supabase.from('jobs').delete().eq('id', id);
  await audit(supabase, profile.id, 'job.deleted', `Deleted job: ${j.role} for ${j.client_name}`);
  revalidatePath('/jobs');
  return { ok: true };
}

/** Temps by name or mobile, to put forward for a job. */
export async function findTempsForJob(jobId: string, q: string) {
  const { supabase } = await requireStaff();
  const query = q.trim();
  if (query.length < 2) return [];
  const digits = query.replace(/\D/g, '');
  const { data: temps } = await supabase.from('temps').select('id,first_name,last_name,mobile,postcode,status').in('status', ['active', 'hold', 'pending', 'invited', 'review']).limit(3000);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = (temps ?? []).filter((x) => {
    const name = `${x.first_name} ${x.last_name}`.toLowerCase();
    const mob = displayMobile(x.mobile).replace(/\D/g, '');
    return (digits.length >= 4 && mob.includes(digits.replace(/^44/, '0'))) || (words.length > 0 && words.every((w) => name.includes(w)));
  }).slice(0, 8);
  const { data: on } = hits.length ? await supabase.from('job_candidates').select('temp_id').eq('job_id', jobId).in('temp_id', hits.map((h) => h.id)) : { data: [] };
  const already = new Set((on ?? []).map((o) => o.temp_id));
  return hits.map((x) => ({ id: x.id, name: `${x.first_name} ${x.last_name}`, mobile: displayMobile(x.mobile), postcode: x.postcode, status: x.status, onJob: already.has(x.id) }));
}

export async function addCandidate(jobId: string, tempId: string, status: 'proposed' | 'confirmed'): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const [{ data: j }, { data: x }] = await Promise.all([
    supabase.from('jobs').select('client_name,role').eq('id', jobId).maybeSingle(),
    supabase.from('temps').select('first_name,last_name').eq('id', tempId).maybeSingle(),
  ]);
  if (!j || !x) return { ok: false, error: 'Not found. Refresh the page.' };
  const { error } = await supabase.from('job_candidates').insert({ job_id: jobId, temp_id: tempId, status, added_by: profile.id });
  if (error) return { ok: false, error: error.code === '23505' ? `${x.first_name} is already on this job.` : SETUP };
  await audit(supabase, profile.id, 'job.candidate_added', `Added ${x.first_name} ${x.last_name} to ${j.role} for ${j.client_name} (${status})`);
  revalidatePath(`/jobs/${jobId}`); revalidatePath('/jobs');
  return { ok: true, message: `${x.first_name} added.` };
}

export async function setCandidate(id: string, status: 'proposed' | 'confirmed' | 'started' | 'dropped' | 'remove'): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const { data: c } = await supabase.from('job_candidates').select('job_id,temps(first_name,last_name),jobs(role,client_name)').eq('id', id).maybeSingle();
  if (!c) return { ok: false, error: 'Not found.' };
  const who = c.temps as unknown as { first_name: string; last_name: string };
  const job = c.jobs as unknown as { role: string; client_name: string };
  if (status === 'remove') await supabase.from('job_candidates').delete().eq('id', id);
  else await supabase.from('job_candidates').update({ status }).eq('id', id);
  await audit(supabase, profile.id, 'job.candidate_status', `${who.first_name} ${who.last_name} on ${job.role} for ${job.client_name}: ${status === 'remove' ? 'removed' : status}`);
  revalidatePath(`/jobs/${c.job_id}`); revalidatePath('/jobs');
  return { ok: true };
}
