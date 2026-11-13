import { requireStaff } from '@/lib/auth';
import { TempsClient, type TempRow } from './TempsClient';

export const dynamic = 'force-dynamic';

export default async function TempsPage() {
  const { supabase, profile } = await requireStaff();
  // Supabase returns at most 1,000 rows per request, so load the list in pages.
  const loadTemps = async () => {
    const all: TempRow[] = [];
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase.from('temps').select('id,first_name,last_name,mobile,postcode,lat,lng,job_types,status,wa_status,added_by,created_at')
        .not('status', 'in', '(invited,review)').order('created_at', { ascending: false }).order('id').range(from, from + 999);
      all.push(...((data ?? []) as TempRow[]));
      if (!data || data.length < 1000 || from > 50000) break;
    }
    return all;
  };
  const [temps, { data: users }] = await Promise.all([
    loadTemps(),
    supabase.from('profiles').select('id,full_name').order('full_name'),
  ]);
  // Weekly hours limits, loaded separately so the list still works before supabase/2026-11-13-hours-limit.sql is run.
  const { data: caps } = await supabase.from('temps').select('id,hours_cap').not('hours_cap', 'is', null);
  const capOf = new Map((caps ?? []).map((c) => [c.id, c.hours_cap as number]));
  for (const t of temps) t.hours_cap = capOf.get(t.id) ?? null;
  return (
    <TempsClient
      temps={temps}
      users={users ?? []}
      me={{ id: profile.id, name: profile.full_name, admin: profile.role === 'admin' }}
    />
  );
}
