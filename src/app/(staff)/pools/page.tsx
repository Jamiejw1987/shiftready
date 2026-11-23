import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { POOL_DAYS } from './days';

export const dynamic = 'force-dynamic';

type Pool = { id: string; client: string; site: string; site_postcode: string; client_sites: { name: string } | null; pool_members: { days: number[] | null }[] | null };

export default async function PoolsPage({ searchParams }: { searchParams: { q?: string } }) {
  const { supabase } = await requireStaff();
  const q = (searchParams.q ?? '').trim().toLowerCase();
  const { data, error } = await supabase.from('pools').select('id,client,site,site_postcode,client_sites(name),pool_members(days)').order('client').order('site');
  const pools = ((data ?? []) as unknown as Pool[]).filter((p) => !q || `${p.client} ${p.site} ${p.site_postcode} ${p.client_sites?.name ?? ''}`.toLowerCase().includes(q));

  // One section per client, with a card for each of its sites.
  const byClient = new Map<string, Pool[]>();
  for (const p of pools) {
    const key = p.client.trim().toLowerCase();
    byClient.set(key, [...(byClient.get(key) ?? []), p]);
  }

  return (
    <>
      <section className="panel">
        <h1>Pools</h1>
        <p className="lede">Everyone booked on a shift at a site goes into that site’s pool automatically. Open a site to mark which days each person wants to work, then text the people free that day when you need cover at short notice.</p>
        {error && <p className="alert">Run <b>supabase/2026-11-23b-pools.sql</b> in Supabase (SQL Editor) to switch this on. It also fills the pools from everyone already booked.</p>}
        <form className="pool-search" action="/pools">
          <input type="search" name="q" defaultValue={searchParams.q ?? ''} placeholder="Search client, site or postcode" aria-label="Search pools" />
          <button className="btn ghost small">Search</button>
        </form>
      </section>

      {[...byClient.values()].map((sites) => (
        <section className="panel" key={sites[0].id}>
          <h2 style={{ marginTop: 0 }}>{sites[0].client}</h2>
          <div className="pool-cards">
            {sites.map((p) => {
              const members = p.pool_members ?? [];
              const perDay = POOL_DAYS.map((d) => members.filter((m) => (m.days ?? []).includes(d.n)).length);
              return (
                <Link key={p.id} href={`/pools/${p.id}`} className="jobcard">
                  <span className="jobcard-top"><b>{p.client_sites?.name ?? p.site}</b><span className="pill blue">{members.length} {members.length === 1 ? 'person' : 'people'}</span></span>
                  <span className="note">{p.client_sites?.name ? `${p.site} · ` : ''}{p.site_postcode}</span>
                  <span className="pool-mini" aria-label="People free each day">
                    {POOL_DAYS.map((d, i) => (
                      <span key={d.n} className={perDay[i] ? 'on' : ''} title={`${perDay[i]} free on ${d.long}`}><i>{d.short}</i><b>{perDay[i]}</b></span>
                    ))}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
      {!error && !pools.length && (
        <section className="panel"><p className="note" style={{ margin: 0 }}>{q ? 'No pools match that search.' : 'No pools yet. They fill up automatically as people are booked on shifts.'}</p></section>
      )}
    </>
  );
}
