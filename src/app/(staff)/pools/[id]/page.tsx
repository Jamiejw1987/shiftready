import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { displayMobile } from '@/lib/phone';
import { PoolGrid, type PoolRow } from './PoolGrid';
import { AddToPool } from './AddToPool';
import { DeletePool } from './DeletePool';
import { MergePool } from './MergePool';
import { londonNow, mondayOf, addDays, nextWeek, weekLabel, effectiveDays } from '@/lib/poolWeek';

export const dynamic = 'force-dynamic';

type Member = {
  id: string; temp_id: string; days: number[] | null; source: string; last_shift: string | null;
  temps: { first_name: string; last_name: string; mobile: string; status: string } | null;
};

export default async function PoolPage({ params, searchParams }: { params: { id: string }; searchParams: { w?: string; merged?: string } }) {
  const { supabase, profile } = await requireStaff();
  const { data: pool } = await supabase.from('pools').select('id,client,site,site_postcode,client_sites(name)').eq('id', params.id).maybeSingle();
  if (!pool) notFound();
  // A pool that was merged away: go to the one it was merged into. (Skipped quietly before the merge SQL is run.)
  const { data: ptr } = await supabase.from('pools').select('merged_into').eq('id', pool.id).maybeSingle();
  const mergedInto = (ptr as { merged_into?: string | null } | null)?.merged_into;
  if (mergedInto) redirect(`/pools/${mergedInto}`);
  // Other pools this one could be merged into.
  const { data: others } = await supabase.from('pools').select('id,client,site,site_postcode,merged_into,client_sites(name),pool_members(count)').neq('id', pool.id).order('client').order('site');
  const { data: raw } = await supabase.from('pool_members').select('id,temp_id,days,source,last_shift,temps(first_name,last_name,mobile,status)').eq('pool_id', pool.id);
  const members = ((raw ?? []) as unknown as Member[]).filter((m) => m.temps);
  // Messages switched off (ongoing at a client, imported): shown so nobody expects them to get the text.
  const { data: off } = members.length ? await supabase.from('temps').select('id,no_comms').in('id', members.map((m) => m.temp_id)) : { data: [] };
  const quiet = new Set(((off ?? []) as { id: string; no_comms?: boolean }[]).filter((t) => t.no_comms).map((t) => t.id));

  // Which view: a week (its Monday) or 'usual'. Default: next week from Friday (when the texts go out), otherwise this week.
  const now = londonNow();
  const thisWeek = mondayOf(now.date), next = nextWeek(now.date);
  const view = searchParams.w === 'usual' ? 'usual' : /^\d{4}-\d{2}-\d{2}$/.test(searchParams.w ?? '') ? mondayOf(searchParams.w!) : now.dow >= 5 ? next : thisWeek;
  const week = view === 'usual' ? undefined : view;
  type WeekRow = { temp_id: string; worker_days: number[]; office_on: number[]; office_off: number[] };
  const [{ data: weekRows, error: weekErr }, { data: asks }] = week && members.length
    ? await Promise.all([
        supabase.from('pool_week').select('temp_id,worker_days,office_on,office_off').eq('pool_id', pool.id).eq('week_start', week),
        supabase.from('pool_week_asks').select('temp_id,sent_at,reminded_at,replied_at').eq('week_start', week).in('temp_id', members.map((m) => m.temp_id)),
      ])
    : [{ data: [], error: null }, { data: [] }];
  const wk = new Map(((weekRows ?? []) as WeekRow[]).map((w) => [w.temp_id, w]));
  const ask = new Map((asks ?? []).map((a) => [a.temp_id, a]));
  const stateOf = (w: WeekRow | undefined) => {
    const st: Record<number, 'worker' | 'office' | 'removed'> = {};
    if (!w) return st;
    for (const d of w.worker_days ?? []) st[d] = 'worker';
    for (const d of w.office_on ?? []) st[d] = 'office';
    for (const d of w.office_off ?? []) if (st[d] === 'worker') st[d] = 'removed';
    return st;
  };

  const rows: PoolRow[] = members
    .map((m) => ({
      id: m.id, tempId: m.temp_id, name: `${m.temps!.first_name} ${m.temps!.last_name}`, first: m.temps!.first_name,
      mobile: displayMobile(m.temps!.mobile), days: week ? effectiveDays(wk.get(m.temp_id)) : m.days ?? [], lastShift: m.last_shift, manual: m.source === 'manual',
      canText: m.temps!.status === 'active' && !quiet.has(m.temp_id), why: quiet.has(m.temp_id) ? 'Messages off' : m.temps!.status === 'hold' ? 'On hold' : m.temps!.status !== 'active' ? 'Not opted in' : '',
      ...(week ? {
        state: stateOf(wk.get(m.temp_id)),
        reply: (() => { const a = ask.get(m.temp_id); return !a?.sent_at ? 'none' : a.replied_at ? 'replied' : a.reminded_at ? 'reminded' : 'asked'; })() as PoolRow['reply'],
      } : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const siteName = (pool.client_sites as unknown as { name: string } | null)?.name;

  return (
    <>
      <section className="panel">
        <p className="note" style={{ margin: '0 0 6px' }}><Link href="/pools">← All pools</Link></p>
        {searchParams.merged && <p className="okmsg" style={{ marginTop: 0 }}>Pools merged. Everyone is now in this pool.</p>}
        <h1 style={{ marginBottom: 4 }}>{pool.client} · {siteName ?? pool.site}</h1>
        <p className="lede">{siteName ? `${pool.site} · ` : ''}{pool.site_postcode}.{' '}
          {week
            ? <>Every Friday 8am everyone here is texted to tick the days they want shifts the next week. <b className="pool-key w">Green</b> = they ticked it, <b className="pool-key o">blue</b> = added by the office. Tap any day to change it after a call; the office’s change always wins. The bottom row is how many can work each day.</>
            : <>Their usual days. Tap a day to turn it green for the days someone usually wants to work.</>}
          {' '}Tap a day heading to tick everyone who can work it, then text them.</p>
        <nav className="pool-weeks" aria-label="Which week">
          {[addDays(thisWeek, -7), thisWeek, next, addDays(next, 7)].map((w) => (
            <Link key={w} href={`/pools/${pool.id}?w=${w}`} className={`chip${view === w ? ' on' : ''}`}>{w === thisWeek ? 'This week' : w === next ? 'Next week' : weekLabel(w)}{w === thisWeek || w === next ? ` · ${weekLabel(w)}` : ''}</Link>
          ))}
          <Link href={`/pools/${pool.id}?w=usual`} className={`chip${view === 'usual' ? ' on' : ''}`}>Usual days</Link>
        </nav>
        {week && weekErr && <p className="alert">Run <b>supabase/2026-11-26-weekly-availability-and-reg-notes.sql</b> in Supabase to switch weekly availability on.</p>}
        {week && !weekErr && rows.length > 0 && (() => {
          const asked = rows.filter((x) => x.reply && x.reply !== 'none').length, replied = rows.filter((x) => x.reply === 'replied').length;
          return <p className="note" style={{ margin: '0 0 8px' }}>{weekLabel(week)}: {asked ? `${replied} of ${asked} asked have replied.` : week >= next ? 'Not asked yet: the text goes out Friday 8am.' : 'Nobody was asked about this week.'}</p>;
        })()}
        <PoolGrid key={view} poolId={pool.id} rows={rows} week={week} siteLabel={`${pool.client} ${siteName ?? pool.site}`} />
      </section>
      <section className="panel">
        <AddToPool poolId={pool.id} />
        <MergePool poolId={pool.id} name={`${pool.client} ${siteName ?? pool.site} (${pool.site_postcode})`}
          options={((others ?? []) as unknown as { id: string; client: string; site: string; site_postcode: string; merged_into?: string | null; client_sites: { name: string } | null; pool_members: { count: number }[] }[])
            .filter((o) => !o.merged_into)
            .map((o) => ({ id: o.id, label: `${o.client} · ${o.client_sites?.name ?? o.site} · ${o.site_postcode}`, count: o.pool_members?.[0]?.count ?? 0, sameClient: o.client.trim().toLowerCase().slice(0, 3) === pool.client.trim().toLowerCase().slice(0, 3) }))
            .sort((a, b) => Number(b.sameClient) - Number(a.sameClient))} />
        {profile.role === 'admin' && <DeletePool poolId={pool.id} name={`${pool.client} (${siteName ?? pool.site})`} />}
      </section>
    </>
  );
}
