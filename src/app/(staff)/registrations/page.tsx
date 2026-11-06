import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { currentDocs, docProblems } from '@/lib/docs';
import { encryptionReady } from '@/lib/crypto';
import { displayMobile } from '@/lib/phone';
import { fmtDateTime } from '@/lib/format';
import { InviteForm, ResendButton, BulkInvite, PublicLink } from './RegClient';
import { appUrl } from '@/lib/texts';
import { createAdminClient } from '@/lib/supabase/admin';
import { applyEndpoint, applyMessage } from '@/lib/applications';
import { ApplyAddress, ApplyMessage, RetryButton } from './ApplyClient';
import { InvitedSearch } from './InvitedSearch';

const OUTCOME: Record<string, [string, string]> = {
  texted: ['ok', 'Link texted'],
  resent: ['ok', 'Link texted again'],
  emailed: ['ok', 'Link emailed'],
  already_registered: ['blue', 'Already registered'],
  opted_out: ['mute', 'Opted out'],
  no_mobile: ['warn', 'No UK mobile'],
  not_sent: ['warn', 'Not sent'],
  failed: ['bad', 'Text failed'],
  saved: ['mute', 'Saved'],
};

export const dynamic = 'force-dynamic';

const PAGE = 50;

/** Turn what was typed into a search_text match: lowercase, no wildcard/filter characters, phone numbers as bare digits without 0/44. */
function cleanSearch(raw: string) {
  const s = raw.trim().toLowerCase().replace(/[%_,()\\]/g, '');
  const compact = s.replace(/[\s+\-]/g, '');
  if (/^\d{4,}$/.test(compact)) return compact.replace(/^(44|0)/, '');
  return s.replace(/\s+/g, ' ');
}

const ago = (iso: string | null) => {
  if (!iso) return '';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
};

export default async function RegistrationsPage({ searchParams }: { searchParams: { q?: string; p?: string } }) {
  const q = (searchParams.q ?? '').slice(0, 80);
  const term = cleanSearch(q);
  const pageNo = Math.max(0, (parseInt(searchParams.p ?? '1', 10) || 1) - 1);
  const { supabase, profile } = await requireStaff();
  let invitedQuery = supabase.from('temps').select('id,first_name,last_name,mobile,status,reg_requested_at,added_by', { count: 'exact' })
    .is('registered_at', null).not('reg_requested_at', 'is', null).neq('status', 'out');
  if (term) invitedQuery = invitedQuery.ilike('search_text', `%${term}%`);
  invitedQuery = invitedQuery.order('reg_requested_at', { ascending: false }).range(pageNo * PAGE, pageNo * PAGE + PAGE - 1);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const soon = new Date(Date.now() + 28 * 864e5).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const [docs, { data: review }, { data: invited, count: invitedCount }, { data: due }, { data: users }] = await Promise.all([
    currentDocs(supabase),
    supabase.from('temps').select('id,first_name,last_name,mobile,postcode,rtw_route,rtw_checked_at,needs_admin_review,registered_at,added_by').eq('status', 'review').order('registered_at'),
    invitedQuery,
    supabase.from('temps').select('id,first_name,last_name,rtw_expires,status').not('rtw_expires', 'is', null).lte('rtw_expires', soon).in('status', ['active', 'hold']).order('rtw_expires'),
    supabase.from('profiles').select('id,full_name'),
  ]);
  const { data: allMobiles } = await supabase.from('temps').select('mobile');
  const [{ data: apps }, applyText, { data: keyRow }] = await Promise.all([
    supabase.from('job_applications').select('id,source,job_title,job_ref,first_name,last_name,email,mobile,phone_raw,postcode,town,cv_path,temp_id,outcome,detail,created_at').order('created_at', { ascending: false }).limit(50),
    applyMessage(supabase),
    profile.role === 'admin' ? createAdminClient().from('app_secrets').select('value').eq('name', 'apply_key').maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const problems = [...(encryptionReady() ? [] : ['the encryption key (FIELD_ENCRYPTION_KEY) hasn’t been added in Vercel']), ...docProblems(docs)];
  const by = (id: string | null) => users?.find((u) => u.id === id)?.full_name ?? '-';
  const total = invitedCount ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const pageHref = (n: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set('q', q);
    if (n > 1) sp.set('p', String(n));
    const qs = sp.toString();
    return `/registrations${qs ? `?${qs}` : ''}#not-finished`;
  };

  return (
    <>
      <section className="panel">
        <h1>Sign-ups</h1>
        <p className="lede">Text a candidate their personal registration link. They fill in their details, right to work, emergency contact and agreements on their phone, then appear below for you to check.</p>
        {problems.length > 0 && (
          <p className="alert" style={{ marginBottom: 14 }}>Registration links are switched off until: {problems.join('; ')}.{profile.role === 'admin' ? <> <Link href="/team/documents">Open Documents</Link></> : ' Ask an admin.'}</p>
        )}
        <InviteForm disabled={problems.length > 0} base={appUrl()} applicantTemplate={applyText} />
      </section>

      <section className="panel">
        <h2>Public sign-up link</h2>
        <p className="lede">One link anyone can use to register: put it in replies to job applicants, adverts or social posts. They enter their name and mobile, we text them their own registration link, and they appear under Ready to check when they’ve finished.</p>
        <PublicLink url={`${appUrl()}/join`} />
      </section>

      <section className="panel">
        <h2>CV-Library applications</h2>
        <p className="lede">Applications from CV-Library come straight in here. Each applicant is added to ShiftReady and texted their own registration link with the message below, then appears under Ready to check when they’ve finished.</p>
        <ApplyMessage current={applyText} base={appUrl()} canEdit={profile.role === 'admin'} />
        {keyRow?.value && <div style={{ marginTop: 14 }}><ApplyAddress url={applyEndpoint(keyRow.value)} /></div>}
        <div className="tablewrap" style={{ marginTop: 14 }}><table className="cards">
          <thead><tr><th>Applicant</th><th>Job</th><th>Mobile</th><th>Applied</th><th>What happened</th><th></th></tr></thead>
          <tbody>
            {(apps ?? []).map((a) => {
              const [tone, label] = OUTCOME[a.outcome] ?? ['mute', a.outcome];
              return (
                <tr key={a.id}>
                  <td><b>{[a.first_name, a.last_name].filter(Boolean).join(' ') || 'No name'}</b>{(a.town || a.postcode) && <><br /><span className="note">{[a.town, a.postcode].filter(Boolean).join(', ')}</span></>}{a.email && <><br /><span className="note">{a.email}</span></>}</td>
                  <td data-l="Job">{a.job_title || a.job_ref || '-'}</td>
                  <td className="num" data-l="Mobile">{a.mobile ? displayMobile(a.mobile) : a.phone_raw || '-'}</td>
                  <td data-l="Applied" title={fmtDateTime(a.created_at)}>{ago(a.created_at)}</td>
                  <td data-l="What happened"><span className={`pill ${tone}`}>{label}</span>{a.detail && <><br /><span className="note">{a.detail}</span></>}</td>
                  <td><div className="btnrow">
                    {a.cv_path && <a className="btn ghost small" href={`/api/applications/${a.id}/cv`} target="_blank" rel="noreferrer">CV</a>}
                    {(['not_sent', 'failed', 'saved'].includes(a.outcome) || (a.outcome === 'no_mobile' && a.email)) && <RetryButton id={a.id} />}
                    {a.temp_id && <Link className="btn ghost small" href={`/temps/${a.temp_id}`}>Open</Link>}
                  </div></td>
                </tr>
              );
            })}
            {!apps?.length && <tr><td colSpan={6} className="note">No applications yet. Once CV-Library switches on DirectApply for your jobs, they’ll appear here.</td></tr>}
          </tbody>
        </table></div>
      </section>

      <section className="panel">
        <h2>Invite applicants in bulk</h2>
        <p className="lede">For people who applied to your roles online or asked about work. Paste a list or upload an export and everyone gets their own registration link.</p>
        <BulkInvite disabled={problems.length > 0} known={(allMobiles ?? []).map((m) => m.mobile)} base={appUrl()} applicantTemplate={applyText} />
      </section>

      <section className="panel">
        <h2>Ready to check <span className="pill blue" style={{ verticalAlign: 'middle' }}>{review?.length ?? 0}</span></h2>
        <p className="lede">Check their right to work, then approve them to start getting shifts.</p>
        <div className="tablewrap"><table className="cards">
          <thead><tr><th>Candidate</th><th>Mobile</th><th>Postcode</th><th>Right to work</th><th>Registered</th><th></th></tr></thead>
          <tbody>
            {(review ?? []).map((t) => (
              <tr key={t.id}>
                <td><b>{t.first_name} {t.last_name}</b>{t.needs_admin_review && <><br /><span className="pill warn">Call first: declared health or convictions</span></>}</td>
                <td className="num" data-l="Mobile">{displayMobile(t.mobile)}</td>
                <td className="mono" data-l="Postcode">{t.postcode}</td>
                <td data-l="Right to work">{t.rtw_checked_at ? <span className="pill ok">Checked</span> : <span className="pill warn">{t.rtw_route === 'share_code' ? 'Share code to check' : 'Passport to see'}</span>}</td>
                <td data-l="Registered">{ago(t.registered_at)}</td>
                <td><Link className="btn blue small" href={`/temps/${t.id}`}>Open</Link></td>
              </tr>
            ))}
            {!review?.length && <tr><td colSpan={6} className="note">Nobody waiting.</td></tr>}
          </tbody>
        </table></div>
      </section>

      <section className="panel">
        <h2>Right to work checks due</h2>
        <p className="lede">Time-limited right to work ending in the next 28 days. Ask them for a new share code and check again. When it expires they’re put on hold automatically.</p>
        <div className="tablewrap"><table className="cards">
          <thead><tr><th>Temp</th><th>Expires</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {(due ?? []).map((t) => (
              <tr key={t.id} className={t.rtw_expires! < today ? 'bad' : ''}>
                <td><b>{t.first_name} {t.last_name}</b></td>
                <td data-l="Expires">{new Date(t.rtw_expires + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}{t.rtw_expires! < today && ' (expired)'}</td>
                <td data-l="Status">{t.status === 'hold' ? <span className="pill mute">On hold</span> : <span className="pill ok">Active</span>}</td>
                <td><Link className="btn ghost small" href={`/temps/${t.id}`}>Open</Link></td>
              </tr>
            ))}
            {!due?.length && <tr><td colSpan={4} className="note">None due.</td></tr>}
          </tbody>
        </table></div>
      </section>

      <section className="panel" id="not-finished">
        <h2>Links sent, not finished yet <span className="pill blue" style={{ verticalAlign: 'middle' }}>{total}</span></h2>
        <InvitedSearch initial={q} />
        <p className="note" style={{ marginBottom: 10 }}>{total} not finished{q && ` matching “${q}”`}{pages > 1 && ` · page ${pageNo + 1} of ${pages}`}</p>
        <div className="tablewrap"><table className="cards">
          <thead><tr><th>Candidate</th><th>Mobile</th><th>Sent</th><th>By</th><th></th></tr></thead>
          <tbody>
            {(invited ?? []).map((t) => (
              <tr key={t.id}>
                <td><b>{t.first_name} {t.last_name}</b></td>
                <td className="num" data-l="Mobile">{displayMobile(t.mobile)}</td>
                <td data-l="Sent" title={t.reg_requested_at ? fmtDateTime(t.reg_requested_at) : ''}>{ago(t.reg_requested_at)}</td>
                <td data-l="By">{by(t.added_by)}</td>
                <td><div className="btnrow"><ResendButton id={t.id} /><Link className="btn ghost small" href={`/temps/${t.id}`}>Open</Link></div></td>
              </tr>
            ))}
            {!invited?.length && <tr><td colSpan={5} className="note">{q ? `Nobody matching “${q}”.` : 'No links waiting.'}</td></tr>}
          </tbody>
        </table></div>
        {pages > 1 && (
          <div className="btnrow" style={{ marginTop: 12 }}>
            {pageNo > 0 ? <Link className="btn ghost small" href={pageHref(pageNo)} scroll={false}>Previous</Link> : <span className="btn ghost small" aria-disabled="true" style={{ opacity: 0.4 }}>Previous</span>}
            {pageNo + 1 < pages ? <Link className="btn ghost small" href={pageHref(pageNo + 2)} scroll={false}>Next</Link> : <span className="btn ghost small" aria-disabled="true" style={{ opacity: 0.4 }}>Next</span>}
          </div>
        )}
      </section>
    </>
  );
}
