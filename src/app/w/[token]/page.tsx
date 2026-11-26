import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { Logo } from '@/components/Logo';
import { weekClosed, weekLabel, addDays } from '@/lib/poolWeek';
import { WeekPicker } from './WeekPicker';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your days next week | ShiftReady' };
const UUID = /^[0-9a-f-]{36}$/i;

/** A worker's link from the Friday text: tick the days they want shifts next week, for each site they work at. */
export default async function WeekPage({ params }: { params: { token: string } }) {
  if (!UUID.test(params.token)) notFound();
  const db = createAdminClient();
  const { data: ask } = await db.from('pool_week_asks').select('temp_id,week_start,replied_at,temps(first_name,status)').eq('token', params.token).maybeSingle();
  if (!ask) notFound();
  const t = ask.temps as unknown as { first_name: string; status: string } | null;
  if (!t) notFound();
  const [{ data: members }, { data: answers }] = await Promise.all([
    db.from('pool_members').select('pool_id,pools(client,site,client_sites(name))').eq('temp_id', ask.temp_id),
    db.from('pool_week').select('pool_id,worker_days').eq('temp_id', ask.temp_id).eq('week_start', ask.week_start),
  ]);
  const have = new Map((answers ?? []).map((a) => [a.pool_id, a.worker_days as number[]]));
  const sites = (members ?? []).map((m) => {
    const p = m.pools as unknown as { client: string; site: string; client_sites: { name: string } | null } | null;
    return { poolId: m.pool_id, name: p ? `${p.client} · ${p.client_sites?.name ?? p.site}` : 'Site', days: have.get(m.pool_id) ?? [] };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const dates = Array.from({ length: 7 }, (_, i) => addDays(ask.week_start, i));

  return (
    <main className="tpage">
      <div className="tbar"><Logo small /></div>
      <div className="tbody">
        <WeekPicker token={params.token} first={t.first_name} week={weekLabel(ask.week_start)} dates={dates} sites={sites}
          closed={weekClosed(ask.week_start)} active={t.status === 'active'} onHold={t.status === 'hold'} replied={!!ask.replied_at} />
      </div>
    </main>
  );
}
