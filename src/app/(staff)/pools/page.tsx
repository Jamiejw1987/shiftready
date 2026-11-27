import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { POOL_DAYS } from './days';
import { londonNow, mondayOf, nextWeek, weekLabel, effectiveDays } from '@/lib/poolWeek';
import { AskNow } from './AskNow';

export const dynamic = 'force-dynamic';

type Pool = { id: string; client: string; site: string; site_postcode: string; client_sites: { name: string } | null; pool_members: { days: number[] | null }[] | null };

export default async function PoolsPage({ searchParams }: { searchParams: { q?: string } }) {
  const { supabase, profile } = await requireStaff();
  const q = (searchParams.q ?? '').trim().toLowerCase();
  // Hide pools merged into another (kept only so old spellings on shifts find the right pool).
  const withMerged = await supabase.from('pools').select('id,client,site,site_postcode,merged_into,client_sites(name),pool_members(days)').order('client').order('site');
  const { data: raw, error } = withMerged.error ? await supabase.from('pools').select('id,client,site,site_postcode,client_sites(name),pool_members(days)').order('client').order('site') : withMerged;
  const data = ((raw ?? []) as { merged_into?: string | null }[]).filter((p) => !p.merged_into);
  // Each card shows how many can work each day: next week from Friday (when the texts go out), otherwise this week.
  const now = londonNow();
  const week = now.dow >= 5 ? nextWeek(now.date) : mondayOf(now.date);
  const { data: wk, error: wkErr } = await supabase.from('pool_week').select('pool_id,worker_days,office_on,office_off').eq('week_start', week);
  const perPool = new Map<string, number[]>();
  for (const w of wk ?? []) {
    const c = perPool.get(w.pool_id) ?? [0, 0, 0, 0, 0, 0, 0];
    for (const d of effectiveDays(w as { worker_days: number[]; office_on: number[]; office_off: number[] })) c[d - 1]++;
    perPool.set(w.pool_id, c);
  }
  const { count: asked } = wkErr ? { count: 0 } : await supabase.from('pool_week_asks').select('id', { count: 'exact', head: true }).eq('week_start', nextWeek(now.date)).not('sent_at', 'is', null);
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
        <div className="pool-ask">
          <span className="note">Weekly availability: everyone in a pool is texted <b>every Friday 8am</b> to tick the days they want shifts the next week, with a reminder Saturday 12pm. Answers close Sunday night. Anyone on hold or with messages off isn’t texted.{asked ? ` ${asked} asked about ${weekLabel(nextWeek(now.date))} so far.` : ''} Cards show {weekLabel(week)}.</span>
          {profile.role === 'admin' && !wkErr && <AskNow week={weekLabel(nextWeek(now.date))} />}
        </div>
        {wkErr && !error && <p className="alert">Run <b>supabase/2026-11-26-weekly-availability-and-reg-notes.sql</b> in Supabase to switch weekly availability on.</p>}
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
              const perDay = perPool.get(p.id) ?? [0, 0, 0, 0, 0, 0, 0];
              return (
                <Link key={p.id} href={`/pools/${p.id}`} className="jobcard">
                  <span className="jobcard-top"><b>{p.client_sites?.name ?? p.site}</b><span className="pill blue">{members.length} {members.length === 1 ? 'person' : 'people'}</span></span>
                  <span className="note">{p.client_sites?.name ? `${p.site} · ` : ''}{p.site_postcode}</span>
                  <span className="pool-mini" aria-label="People free each day">
                    {POOL_DAYS.map((d, i) => (
                      <span key={d.n} className={perDay[i] ? 'on' : ''} title={`${perDay[i]} can work ${d.long} (${weekLabel(week)})`}><i>{d.short}</i><b>{perDay[i]}</b></span>
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
