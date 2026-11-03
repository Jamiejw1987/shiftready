'use server';
import { revalidatePath } from 'next/cache';
import { requireStaff } from '@/lib/auth';
import { clientAudit, whenWord } from '@/lib/clients';
import { sendEmail, clientStream } from '@/lib/email';
import { appUrl } from '@/lib/texts';

type Result = { ok: boolean; error?: string; message?: string };

/** "I'm on it": the client sees Acknowledged straight away. */
export async function acknowledgeRequest(id: string): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const now = new Date().toISOString();
  const { data: r } = await supabase.from('client_requests').update({ status: 'acknowledged', acknowledged_by: profile.id, acknowledged_at: now, updated_at: now })
    .eq('id', id).eq('status', 'submitted').select('id,client_id,request_date,clients(name)').maybeSingle();
  if (!r) return { ok: false, error: 'Already picked up or cancelled. Refresh the page.' };
  await clientAudit(supabase, { actor: profile.id, action: 'request.acknowledged', clientId: r.client_id, entity: 'request', entityId: r.id, detail: `${profile.full_name} picked up ${(r.clients as unknown as { name: string }).name}'s request for ${whenWord(r.request_date)}` });
  revalidatePath(`/client-requests/${id}`);
  revalidatePath('/client-requests');
  return { ok: true, message: 'Marked as picked up. The client can see it’s being handled.' };
}

/** The office can't fill it (or agreed with the client to drop it). The person who posted it gets an email. */
export async function officeCancelRequest(id: string, reason: string): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const { data: r } = await supabase.from('client_requests').select('id,client_id,status,request_date,start_time,end_time,headcount,created_by,clients(name),client_sites(name)').eq('id', id).maybeSingle();
  if (!r || r.status === 'cancelled') return { ok: false, error: 'Already cancelled.' };
  const { data: shift } = await supabase.from('shifts').select('id').eq('request_id', id).neq('status', 'cancelled').maybeSingle();
  if (shift) return { ok: false, error: 'There’s a shift for this request. Cancel the shift instead, so booked temps get a text.' };
  const why = reason.trim().slice(0, 300) || null;
  const now = new Date().toISOString();
  await supabase.from('client_requests').update({ status: 'cancelled', cancelled_at: now, cancelled_by_client: false, cancel_reason: why ?? 'Cancelled by Staff Selection', updated_at: now }).eq('id', id);
  const client = (r.clients as unknown as { name: string }).name;
  const site = (r.client_sites as unknown as { name: string } | null)?.name ?? '';
  await clientAudit(supabase, { actor: profile.id, action: 'request.cancelled_by_office', clientId: r.client_id, entity: 'request', entityId: r.id, detail: `${profile.full_name} cancelled ${client}'s ${site} request for ${whenWord(r.request_date)}${why ? `: ${why}` : ''}` });
  if (r.created_by) {
    const { data: cu } = await supabase.from('client_users').select('email,full_name,status').eq('id', r.created_by).maybeSingle();
    if (cu && cu.status !== 'removed') await sendEmail({
      to: cu.email, stream: clientStream(), tag: 'client-request-cancelled',
      subject: `Update on your ${site} shift ${whenWord(r.request_date)}`,
      text: `Hi ${(cu.full_name || '').split(' ')[0] || 'there'},\n\nWe’ve cancelled your request for ${r.headcount} ${r.headcount === 1 ? 'person' : 'people'} at ${site}, ${whenWord(r.request_date)}, ${r.start_time.slice(0, 5)} to ${r.end_time.slice(0, 5)}.${why ? `\n\n${why}` : ''}\n\nPlease call us if you have any questions.\n\n${appUrl()}/portal\n\nStaff Selection UK`,
    });
  }
  revalidatePath(`/client-requests/${id}`);
  revalidatePath('/client-requests');
  return { ok: true, message: 'Cancelled, and the client has been emailed.' };
}
