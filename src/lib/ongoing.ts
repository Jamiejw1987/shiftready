import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Assignment } from '@/app/(staff)/ongoing/Ongoing';

type Row = { id: string; client_id: string; temp_id: string; job_title: string | null; start_date: string; end_date: string | null; notes: string | null; clients: unknown; client_sites: unknown; temps: unknown };

/** Ongoing assignments for one worker or one client. Empty until supabase/2026-11-16-ongoing-workers.sql is run. */
export async function loadAssignments(db: SupabaseClient, by: { tempId?: string; clientId?: string }): Promise<{ list: Assignment[]; ready: boolean }> {
  // Supabase returns at most 1,000 rows per request, so load in pages.
  const data: Record<string, unknown>[] = [];
  for (let from = 0; from < 50000; from += 1000) {
    let q = db.from('client_workers')
      .select('id,client_id,temp_id,job_title,start_date,end_date,notes,clients(name),client_sites(name),temps(first_name,last_name,mobile)')
      .order('end_date', { ascending: false, nullsFirst: true }).order('start_date', { ascending: false }).order('id').range(from, from + 999);
    if (by.tempId) q = q.eq('temp_id', by.tempId);
    if (by.clientId) q = q.eq('client_id', by.clientId);
    const { data: page, error } = await q;
    if (error) return { list: [], ready: false };
    data.push(...(page ?? []));
    if (!page || page.length < 1000) break;
  }
  return {
    ready: true,
    list: (data as Row[]).map((r) => {
      const c = r.clients as unknown as { name: string } | null, s = r.client_sites as unknown as { name: string } | null;
      const t = r.temps as unknown as { first_name: string; last_name: string; mobile: string } | null;
      return {
        id: r.id, client_id: r.client_id, client_name: c?.name ?? 'Client', site_name: s?.name ?? null, temp_id: r.temp_id,
        temp_name: t ? `${t.first_name} ${t.last_name}` : 'Worker', mobile: t?.mobile, job_title: r.job_title, start_date: r.start_date,
        end_date: r.end_date, notes: r.notes,
      };
    }),
  };
}

export const isCurrent = (a: { end_date: string | null }, today: string) => !a.end_date || a.end_date >= today;
