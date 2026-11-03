import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { displayMobile } from '@/lib/phone';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { ClientSettings, SiteEditor, InviteUser, UserActions, LiftBlock } from '../ClientForms';
import { LogoUpload } from '../LogoUpload';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f-]{36}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function ClientProfile({ params, searchParams }: { params: { id: string }; searchParams: { user?: string; from?: string; to?: string; q?: string } }) {
  if (!UUID.test(params.id)) notFound();
  const { supabase, profile } = await requireStaff();
  const { data: c } = await supabase.from('clients').select('*').eq('id', params.id).maybeSingle();
  if (!c) notFound();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);

  // The activity log is otherwise admin-only; office users can see the part about this client.
  const admin = createAdminClient();
  let act = admin.from('audit_log').select('id,actor,client_user_id,action,detail,created_at').eq('client_id', c.id).order('created_at', { ascending: false }).limit(200);
  if (searchParams.user && UUID.test(searchParams.user)) act = act.eq('client_user_id', searchParams.user);
  if (searchParams.from && DATE.test(searchParams.from)) act = act.gte('created_at', `${searchParams.from}T00:00:00Z`);
  if (searchParams.to && DATE.test(searchParams.to)) act = act.lte('created_at', `${searchParams.to}T23:59:59Z`);
  if (searchParams.q?.trim()) act = act.ilike('detail', `%${searchParams.q.trim().replace(/[%_]/g, '')}%`);

  const [{ data: sites }, { data: users }, { data: links }, { data: reqs }, { data: blocks }, { data: fb }, { data: log }, { data: staff }, { data: userActs }] = await Promise.all([
    supabase.from('client_sites').select('id,name,address,postcode,active').eq('client_id', c.id).order('name'),
    supabase.from('client_users').select('*').eq('client_id', c.id).order('status').order('full_name'),
    supabase.from('client_user_sites').select('client_user_id,site_id'),
    supabase.from('client_requests').select('id,request_date,start_time,end_time,role,headcount,status,is_urgent,site_id').eq('client_id', c.id).gte('request_date', since).order('request_date', { ascending: false }).limit(60),
    supabase.from('client_blocks').select('id,temp_id,reason,created_at,created_by,temps(first_name,last_name)').eq('client_id', c.id).is('lifted_at', null).order('created_at', { ascending: false }),
    supabase.from('client_feedback').select('stars,attended').eq('client_id', c.id),
    act,
    supabase.from('profiles').select('id,full_name'),
    admin.from('audit_log').select('client_user_id').eq('client_id', c.id).not('client_user_id', 'is', null),
  ]);
  const siteName = (id: string) => sites?.find((s) => s.id === id)?.name ?? '';
  const userName = (id: string | null) => { const u = users?.find((x) => x.id === id); return u ? u.full_name || u.email : ''; };
  const staffName = (id: string | null) => staff?.find((s) => s.id === id)?.full_name ?? '';
  const rated = (fb ?? []).filter((f) => f.stars);
  const avg = rated.length ? rated.reduce((n, f) => n + (f.stars ?? 0), 0) / rated.length : null;
  const noShows = (fb ?? []).filter((f) => f.attended === false).length;
  const actCount = (id: string) => (userActs ?? []).filter((a) => a.client_user_id === id).length;
  const liveSites = (sites ?? []).filter((s) => s.active);
  const isAdmin = profile.role === 'admin';

  return (
    <>
      <section className="panel">
        <p className="note" style={{ margin: '0 0 6px' }}><Link href="/clients">← Clients</Link></p>
        <div className="phead">
          <div>
            <h1>{c.name}</h1>
            <div className="btnrow">
              {c.is_test && <span className="pill blue">Test client</span>}
              <span className={`pill ${c.active ? 'ok' : 'mute'}`}>{c.active ? 'Active' : 'Switched off'}</span>
              <span className="pill mute">Short notice: under {c.cutoff_hours} hrs</span>
              {avg != null && <span className="pill mute">Avg rating given ★ {avg.toFixed(1)} ({rated.length})</span>}
              {noShows > 0 && <span className="pill warn">{noShows} no-show{noShows === 1 ? '' : 's'} reported</span>}
            </div>
          </div>
          <div className="btnrow">
            <Link className="btn blue small" href={`/clients/${c.id}/view`}>View as client</Link>
            <Link className="btn ghost small" href={`/clients/${c.id}/report`}>Report</Link>
            <a className="btn ghost small" href={`/api/clients/${c.id}/contacts`}>Export contacts</a>
            <ClientSettings id={c.id} admin={isAdmin} initial={{ name: c.name, cutoff: c.cutoff_hours, isTest: c.is_test, active: c.active }} />
          </div>
        </div>
        <div style={{ marginTop: 14 }}><LogoUpload id={c.id} name={c.name} logo={(c as { logo?: string | null }).logo ?? null} /></div>
      </section>

      <section className="panel">
        <h2>Portal users</h2>
        <div className="tablewrap"><table className="cards">
          <thead><tr><th>Name</th><th>Contact</th><th>Sites</th><th>Invited</th><th>Last sign-in</th><th></th></tr></thead>
          <tbody>
            {(users ?? []).map((u) => {
              const mine = (links ?? []).filter((l) => l.client_user_id === u.id).map((l) => l.site_id);
              return (
                <tr key={u.id} style={u.status === 'removed' ? { opacity: 0.55 } : undefined}>
                  <td><b>{u.full_name || <span className="note">Not signed in yet</span>}</b>{u.job_title && <div className="note">{u.job_title}</div>}
                    <div><Link className="note" href={`/clients/${c.id}?user=${u.id}#activity`}>{actCount(u.id)} action{actCount(u.id) === 1 ? '' : 's'}</Link></div></td>
                  <td data-l="Contact"><a href={`mailto:${u.email}`}>{u.email}</a>{u.mobile && <div className="mono">{displayMobile(u.mobile)}</div>}</td>
                  <td data-l="Sites">{u.all_sites ? 'All sites' : mine.map(siteName).join(', ') || '-'}</td>
                  <td data-l="Invited">{fmtDate(u.invited_at.slice(0, 10))}{u.joined_at ? <div className="note">Joined {fmtDate(u.joined_at.slice(0, 10))}</div> : <div><span className="pill warn">Invited</span></div>}</td>
                  <td data-l="Last sign-in">{u.last_login_at ? fmtDateTime(u.last_login_at) : '-'}</td>
                  <td><UserActions id={u.id} status={u.status} sites={liveSites} allSites={u.all_sites} mySites={mine} /></td>
                </tr>
              );
            })}
            {!users?.length && <tr><td colSpan={6} className="note">Nobody yet. Invite their shift managers below.</td></tr>}
          </tbody>
        </table></div>
        {c.active && <InviteUser clientId={c.id} sites={liveSites} />}
      </section>

      <section className="panel">
        <h2>Sites</h2>
        <div className="tablewrap"><table>
          <tbody>
            {(sites ?? []).map((s) => (
              <tr key={s.id} style={s.active ? undefined : { opacity: 0.55 }}>
                <td><b>{s.name}</b>{!s.active && <> <span className="pill mute">Not in use</span></>}<div className="note">{s.address}, {s.postcode}</div></td>
                <td style={{ textAlign: 'right' }}><SiteEditor clientId={c.id} site={s} /></td>
              </tr>
            ))}
            {!sites?.length && <tr><td className="note">No sites yet.</td></tr>}
          </tbody>
        </table></div>
        <div style={{ marginTop: 10 }}><SiteEditor clientId={c.id} /></div>
      </section>

      <section className="panel">
        <h2>Requests</h2>
        <p className="lede">Last 30 days and everything coming up.</p>
        <div className="tablewrap"><table className="cards">
          <thead><tr><th>When</th><th>Site</th><th>Need</th><th>Status</th></tr></thead>
          <tbody>
            {(reqs ?? []).map((r) => (
              <tr key={r.id}>
                <td><Link href={`/client-requests/${r.id}`}><b>{fmtDate(r.request_date)}</b></Link> <span className="note">{r.start_time.slice(0, 5)}-{r.end_time.slice(0, 5)}</span></td>
                <td data-l="Site">{siteName(r.site_id)}</td>
                <td data-l="Need">{r.headcount} × {r.role}</td>
                <td><span className={`pill ${r.status === 'cancelled' ? 'bad' : r.status === 'submitted' ? 'warn' : r.request_date < today ? 'mute' : 'blue'}`}>{r.status === 'submitted' ? 'New' : r.status === 'acknowledged' ? 'Picked up' : 'Cancelled'}</span>{r.is_urgent && r.status !== 'cancelled' && <> <span className="pill warn">Urgent</span></>}</td>
              </tr>
            ))}
            {!reqs?.length && <tr><td colSpan={4} className="note">No requests yet.</td></tr>}
          </tbody>
        </table></div>
      </section>

      <section className="panel">
        <h2>Blocked temps</h2>
        <p className="lede">People {c.name} asked not to have back. They’re kept off {c.name} shifts only.{isAdmin ? '' : ' Only admins can lift a block.'}</p>
        <div className="tablewrap"><table>
          <tbody>
            {(blocks ?? []).map((b) => {
              const t = b.temps as unknown as { first_name: string; last_name: string } | null;
              return (
                <tr key={b.id}>
                  <td><Link href={`/temps/${b.temp_id}`}><b>{t ? `${t.first_name} ${t.last_name}` : 'Deleted temp'}</b></Link><div className="note">{fmtDate(b.created_at.slice(0, 10))}{b.created_by ? ` by ${userName(b.created_by)}` : ''}{b.reason ? ` · “${b.reason}”` : ''}</div></td>
                  <td style={{ textAlign: 'right' }}>{isAdmin && <LiftBlock id={b.id} />}</td>
                </tr>
              );
            })}
            {!blocks?.length && <tr><td className="note">Nobody blocked.</td></tr>}
          </tbody>
        </table></div>
      </section>

      <section className="panel" id="activity">
        <h2>Activity</h2>
        <form className="filters" style={{ marginBottom: 12 }}>
          <div className="f"><label className="l" htmlFor="au">Person</label>
            <select id="au" name="user" defaultValue={searchParams.user ?? ''}><option value="">Everyone</option>{(users ?? []).map((u) => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}</select></div>
          <div className="f"><label className="l" htmlFor="af">From</label><input id="af" type="date" name="from" defaultValue={searchParams.from ?? ''} /></div>
          <div className="f"><label className="l" htmlFor="at">To</label><input id="at" type="date" name="to" defaultValue={searchParams.to ?? ''} /></div>
          <div className="f"><label className="l" htmlFor="aq">Contains</label><input id="aq" type="search" name="q" placeholder="e.g. Bradford, no-show" defaultValue={searchParams.q ?? ''} /></div>
          <div className="f" style={{ justifyContent: 'flex-end' }}><button className="btn ghost">Search</button></div>
        </form>
        <div className="tablewrap"><table className="cards">
          <thead><tr><th>Time</th><th>By</th><th>What happened</th></tr></thead>
          <tbody>
            {(log ?? []).map((a) => (
              <tr key={a.id}>
                <td className="mono" data-l="Time">{fmtDateTime(a.created_at)}</td>
                <td data-l="By"><b>{a.client_user_id ? userName(a.client_user_id) : a.actor ? staffName(a.actor) : 'Temp / system'}</b>{a.client_user_id ? <div className="note">{c.name}</div> : a.actor ? <div className="note">Staff Selection</div> : null}</td>
                <td className="full">{a.detail}</td>
              </tr>
            ))}
            {!log?.length && <tr><td colSpan={3} className="note">Nothing found.</td></tr>}
          </tbody>
        </table></div>
      </section>
    </>
  );
}
