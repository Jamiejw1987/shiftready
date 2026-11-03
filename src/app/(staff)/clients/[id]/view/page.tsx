import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadRequests } from '@/lib/portalData';
import { clientAudit, today } from '@/lib/clients';
import { RequestCard } from '@/app/portal/ui/RequestCard';
import { ClientBrand } from '@/components/ClientMark';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f-]{36}$/i;

/** What the client sees in their portal, read-only. Pick a user to see exactly their sites. Every look is recorded. */
export default async function ViewAsClient({ params, searchParams }: { params: { id: string }; searchParams: { as?: string } }) {
  if (!UUID.test(params.id)) notFound();
  const { supabase, profile } = await requireStaff();
  const { data: c } = await supabase.from('clients').select('*').eq('id', params.id).maybeSingle();
  if (!c) notFound();
  const [{ data: sites }, { data: users }] = await Promise.all([
    supabase.from('client_sites').select('id,name').eq('client_id', c.id).eq('active', true).order('name'),
    supabase.from('client_users').select('id,full_name,email,all_sites').eq('client_id', c.id).neq('status', 'removed').order('full_name'),
  ]);
  const as = users?.find((u) => u.id === searchParams.as) ?? null;
  let siteIds = (sites ?? []).map((s) => s.id);
  if (as && !as.all_sites) {
    const { data: mine } = await supabase.from('client_user_sites').select('site_id').eq('client_user_id', as.id);
    siteIds = siteIds.filter((id) => (mine ?? []).some((m) => m.site_id === id));
  }
  const back = new Date(Date.now() - 14 * 864e5).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const all = await loadRequests(supabase, createAdminClient(), c.id, siteIds, { from: back });
  await clientAudit(supabase, { actor: profile.id, action: 'client.viewed_as', clientId: c.id, entity: 'client', entityId: c.id, detail: `${profile.full_name} viewed the ${c.name} portal${as ? ` as ${as.full_name || as.email}` : ''}` });
  const t = today();
  const upcoming = all.filter((r) => !r.started && r.date >= t);
  const past = all.filter((r) => r.started).reverse();

  return (
    <>
      <section className="panel">
        <p className="note" style={{ margin: '0 0 6px' }}><Link href={`/clients/${c.id}`}>← {c.name}</Link></p>
        <div style={{ margin: '6px 0 10px' }}><ClientBrand name={c.name} logo={c.logo} /></div>
        <h1>Viewing as {as ? as.full_name || as.email : c.name}</h1>
        <p className="alert" style={{ margin: '8px 0 12px' }}>Read-only preview of the client portal. Clients see names and the induction flag only: never phone numbers or other details.</p>
        <form className="btnrow">
          <select name="as" defaultValue={as?.id ?? ''} aria-label="View as">
            <option value="">All sites</option>
            {(users ?? []).map((u) => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
          </select>
          <button className="btn ghost small">Switch</button>
        </form>
      </section>
      <section className="panel">
        <h2>Coming up</h2>
        {upcoming.length ? <div className="pgrid">{upcoming.map((r) => <RequestCard key={r.id} r={r} people readOnly />)}</div> : <p className="note">Nothing coming up.</p>}
      </section>
      <section className="panel">
        <h2>Last 14 days</h2>
        {past.length ? <div className="pgrid">{past.map((r) => <RequestCard key={r.id} r={r} people readOnly />)}</div> : <p className="note">Nothing in the last 14 days.</p>}
      </section>
    </>
  );
}
