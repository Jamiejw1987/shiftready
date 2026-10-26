import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { currentDocs, docProblems } from '@/lib/docs';
import { encryptionReady } from '@/lib/crypto';
import { displayMobile } from '@/lib/phone';
import { fmtDateTime } from '@/lib/format';
import { InviteForm, ResendButton, BulkInvite } from './RegClient';

export const dynamic = 'force-dynamic';

const ago = (iso: string | null) => {
  if (!iso) return '';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
};

export default async function RegistrationsPage() {
  const { supabase, profile } = await requireStaff();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const soon = new Date(Date.now() + 28 * 864e5).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const [docs, { data: review }, { data: invited }, { data: due }, { data: users }] = await Promise.all([
    currentDocs(supabase),
    supabase.from('temps').select('id,first_name,last_name,mobile,postcode,rtw_route,rtw_checked_at,needs_admin_review,registered_at,added_by').eq('status', 'review').order('registered_at'),
    supabase.from('temps').select('id,first_name,last_name,mobile,status,reg_requested_at,added_by').is('registered_at', null).not('reg_requested_at', 'is', null).neq('status', 'out').order('reg_requested_at', { ascending: false }),
    supabase.from('temps').select('id,first_name,last_name,rtw_expires,status').not('rtw_expires', 'is', null).lte('rtw_expires', soon).in('status', ['active', 'hold']).order('rtw_expires'),
    supabase.from('profiles').select('id,full_name'),
  ]);
  const { data: allMobiles } = await supabase.from('temps').select('mobile');
  const problems = [...(encryptionReady() ? [] : ['the encryption key (FIELD_ENCRYPTION_KEY) hasn’t been added in Vercel']), ...docProblems(docs)];
  const by = (id: string | null) => users?.find((u) => u.id === id)?.full_name ?? '-';

  return (
    <>
      <section className="panel">
        <h1>Sign-ups</h1>
        <p className="lede">Text a candidate their personal registration link. They fill in their details, right to work, emergency contact and agreements on their phone, then appear below for you to check.</p>
        {problems.length > 0 && (
          <p className="alert" style={{ marginBottom: 14 }}>Registration links are switched off until: {problems.join('; ')}.{profile.role === 'admin' ? <> <Link href="/team/documents">Open Documents</Link></> : ' Ask an admin.'}</p>
        )}
        <InviteForm disabled={problems.length > 0} />
      </section>

      <section className="panel">
        <h2>Invite applicants in bulk</h2>
        <p className="lede">For people who applied to your roles online or asked about work. Paste a list or upload an export and everyone gets their own registration link.</p>
        <BulkInvite disabled={problems.length > 0} known={(allMobiles ?? []).map((m) => m.mobile)} />
      </section>

      <section className="panel">
        <h2>Ready to check <span className="pill blue" style={{ verticalAlign: 'middle' }}>{review?.length ?? 0}</span></h2>
        <p className="lede">Check their right to work, then approve them to start getting shifts.</p>
        <div className="tablewrap"><table className="cards">
          <thead><tr><th>Candidate</th><th>Mobile</th><th>Postcode</th><th>Right to work</th><th>Registered</th><th></th></tr></thead>
          <tbody>
            {(review ?? []).map((t) => (
              <tr key={t.id}>
                <td><b>{t.first_name} {t.last_name}</b>{t.needs_admin_review && <><br /><span className="pill warn">Admin to approve</span></>}</td>
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

      <section className="panel">
        <h2>Links sent, not finished yet</h2>
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
            {!invited?.length && <tr><td colSpan={5} className="note">No links waiting.</td></tr>}
          </tbody>
        </table></div>
      </section>
    </>
  );
}
