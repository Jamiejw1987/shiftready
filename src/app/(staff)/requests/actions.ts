'use server';
import { revalidatePath } from 'next/cache';
import { requireStaff, audit } from '@/lib/auth';
import { sendToTemp } from '@/lib/sms';
import { holidayDecisionText, holidayRange, p45SentText, p45DeclinedText } from '@/lib/texts';

/** Payroll contacts and admins answer requests. The temp gets a text either way. */
export async function decide(id: string, action: 'approve' | 'decline' | 'done', note: string) {
  const { supabase, profile } = await requireStaff();
  const isPayroll = (profile as unknown as { payroll?: boolean }).payroll;
  if (!isPayroll && profile.role !== 'admin') return { ok: false, error: 'Only payroll or an admin can answer requests.' };
  const { data: r } = await supabase.from('temp_requests').select('*, temps(id,first_name,last_name,mobile,status)').eq('id', id).single();
  if (!r) return { ok: false, error: 'Request not found.' };
  if (r.status !== 'pending') return { ok: false, error: 'This request has already been answered.' };
  if (r.kind === 'holiday' && action === 'done') return { ok: false, error: 'Approve or decline holiday requests.' };
  if (r.kind === 'p45' && action === 'approve') return { ok: false, error: 'Mark the P45 as sent instead.' };
  const t = r.temps as { id: string; first_name: string; last_name: string; mobile: string; status: string };
  const clean = note.replace(/\s+/g, ' ').trim().slice(0, 300) || null;
  const status = action === 'approve' ? 'approved' : action === 'decline' ? 'declined' : 'done';
  await supabase.from('temp_requests').update({ status, response_note: clean, handled_by: profile.id, handled_at: new Date().toISOString() }).eq('id', id);
  const body = r.kind === 'holiday'
    ? holidayDecisionText(t.first_name, r.start_date, r.end_date, action === 'approve', clean)
    : action === 'done' ? p45SentText(t.first_name, r.delivery, clean) : p45DeclinedText(t.first_name, clean);
  // These are about their pay, so they're sent even if the temp has stopped shift offers.
  const sms = await sendToTemp({ db: supabase, temp: t, kind: 'system', sentBy: profile.id, body });
  const what = r.kind === 'holiday' ? `holiday ${holidayRange(r.start_date, r.end_date)}` : 'P45 request';
  await audit(supabase, profile.id, `request.${status}`, `${status === 'done' ? 'Sent P45 for' : status === 'approved' ? 'Approved' : 'Declined'} ${t.first_name} ${t.last_name}${status === 'done' ? '' : `'s ${what}`}`);
  revalidatePath('/requests');
  return { ok: true, message: `Done. ${t.first_name} ${sms.ok ? 'has been texted' : 'couldn’t be texted'}.` };
}
