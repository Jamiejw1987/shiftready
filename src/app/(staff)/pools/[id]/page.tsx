import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { displayMobile } from '@/lib/phone';
import { PoolGrid, type PoolRow } from './PoolGrid';
import { AddToPool } from './AddToPool';
import { DeletePool } from './DeletePool';

export const dynamic = 'force-dynamic';

type Member = {
  id: string; temp_id: string; days: number[] | null; source: string; last_shift: string | null;
  temps: { first_name: string; last_name: string; mobile: string; status: string } | null;
};

export default async function PoolPage({ params }: { params: { id: string } }) {
  const { supabase, profile } = await requireStaff();
  const { data: pool } = await supabase.from('pools').select('id,client,site,site_postcode,client_sites(name)').eq('id', params.id).maybeSingle();
  if (!pool) notFound();
  const { data: raw } = await supabase.from('pool_members').select('id,temp_id,days,source,last_shift,temps(first_name,last_name,mobile,status)').eq('pool_id', pool.id);
  const members = ((raw ?? []) as unknown as Member[]).filter((m) => m.temps);
  // Messages switched off (ongoing at a client, imported): shown so nobody expects them to get the text.
  const { data: off } = members.length ? await supabase.from('temps').select('id,no_comms').in('id', members.map((m) => m.temp_id)) : { data: [] };
  const quiet = new Set(((off ?? []) as { id: string; no_comms?: boolean }[]).filter((t) => t.no_comms).map((t) => t.id));

  const rows: PoolRow[] = members
    .map((m) => ({
      id: m.id, tempId: m.temp_id, name: `${m.temps!.first_name} ${m.temps!.last_name}`, first: m.temps!.first_name,
      mobile: displayMobile(m.temps!.mobile), days: m.days ?? [], lastShift: m.last_shift, manual: m.source === 'manual',
      canText: m.temps!.status === 'active' && !quiet.has(m.temp_id), why: quiet.has(m.temp_id) ? 'Messages off' : m.temps!.status === 'hold' ? 'On hold' : m.temps!.status !== 'active' ? 'Not opted in' : '',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const siteName = (pool.client_sites as unknown as { name: string } | null)?.name;

  return (
    <>
      <section className="panel">
        <p className="note" style={{ margin: '0 0 6px' }}><Link href="/pools">← All pools</Link></p>
        <h1 style={{ marginBottom: 4 }}>{pool.client} · {siteName ?? pool.site}</h1>
        <p className="lede">{siteName ? `${pool.site} · ` : ''}{pool.site_postcode}. Tap a day to turn it green for the days someone wants to work. Tap a day heading to tick everyone green that day, then text them.</p>
        <PoolGrid poolId={pool.id} rows={rows} siteLabel={`${pool.client} ${siteName ?? pool.site}`} />
      </section>
      <section className="panel">
        <AddToPool poolId={pool.id} />
        {profile.role === 'admin' && <DeletePool poolId={pool.id} name={`${pool.client} (${siteName ?? pool.site})`} />}
      </section>
    </>
  );
}
