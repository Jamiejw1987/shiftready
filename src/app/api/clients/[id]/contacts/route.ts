import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { clientAudit } from '@/lib/clients';

export const dynamic = 'force-dynamic';

/** The client's portal users as a spreadsheet, to import into the CRM. Business development is sent from there, never from ShiftReady. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { supabase, profile } = await requireStaff();
  const { data: c } = await supabase.from('clients').select('id,name').eq('id', params.id).maybeSingle();
  if (!c) return new NextResponse('Not found', { status: 404 });
  const [{ data: users }, { data: sites }, { data: links }] = await Promise.all([
    supabase.from('client_users').select('id,full_name,job_title,email,mobile,all_sites,status,joined_at,last_login_at').eq('client_id', c.id).neq('status', 'removed').order('full_name'),
    supabase.from('client_sites').select('id,name').eq('client_id', c.id),
    supabase.from('client_user_sites').select('client_user_id,site_id'),
  ]);
  const q = (v: string | null | undefined) => { const s = v ?? ''; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const local = (m: string | null) => (m?.startsWith('+44') ? '0' + m.slice(3) : m ?? '');
  const head = ['Company', 'Name', 'Job title', 'Email', 'Mobile', 'Sites', 'Status', 'Joined', 'Last sign-in'];
  const rows = (users ?? []).map((u) => [
    c.name, u.full_name, u.job_title, u.email, local(u.mobile),
    u.all_sites ? 'All sites' : (links ?? []).filter((l) => l.client_user_id === u.id).map((l) => sites?.find((s) => s.id === l.site_id)?.name).filter(Boolean).join('; '),
    u.joined_at ? 'Active' : 'Invited', u.joined_at?.slice(0, 10) ?? '', u.last_login_at?.slice(0, 10) ?? '',
  ]);
  await clientAudit(supabase, { actor: profile.id, action: 'client.contacts_exported', clientId: c.id, entity: 'client', entityId: c.id, detail: `${profile.full_name} exported ${rows.length} ${c.name} contacts` });
  const slug = c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return new NextResponse('﻿' + [head, ...rows].map((r) => r.map(q).join(',')).join('\r\n'), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${slug}-contacts.csv"`, 'Cache-Control': 'no-store' },
  });
}
