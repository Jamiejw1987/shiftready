import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { displayMobile } from '@/lib/phone';
import { fmtDateTime, shiftWhen } from '@/lib/format';
import { DOC_LABEL, type DocKind } from '@/lib/docs';
import { DOC_KIND_LABEL, type DocKindFile } from '@/lib/storage';
import { RecordActions, RtwCheck, Uploader, Reveal, BankActions } from './TempRecord';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, [string, string]> = {
  invited: ['warn', 'Link sent'], review: ['blue', 'Ready to check'], pending: ['warn', 'Awaiting opt-in'],
  active: ['ok', 'Active'], hold: ['mute', 'On hold'], out: ['bad', 'Opted out'],
};
const OFFER: Record<string, string> = { sent: 'No reply', accepted: 'Booked', declined: 'Declined', standby: 'Standby', alerts: 'Alerts', noshow: 'No-show' };
const day = (d: string | null) => (d ? new Date(d.length === 10 ? d + 'T12:00:00Z' : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-');

export default async function TempRecordPage({ params }: { params: { id: string } }) {
  const { supabase, profile } = await requireStaff();
  const { data: t } = await supabase.from('temps').select('*').eq('id', params.id).maybeSingle();
  if (!t) notFound();
  const [{ data: p }, { data: docs }, { data: sigs }, { data: offers }, { data: users }] = await Promise.all([
    supabase.from('temp_profiles')
      .select('dob,email,address1,address2,town,experience,transport,own_ppe,availability,share_code,nok_name,nok_relationship,nok_phone,wtr_opt_out,wtr_changed_at,wtr_effective,privacy_ack_at,messages_consent,signature_name,signed_at,signed_ip,bank_last4,bank_added_at,submitted_at,ni_enc,health_enc,convictions_enc')
      .eq('temp_id', t.id).maybeSingle(),
    supabase.from('temp_documents').select('id,kind,filename,uploaded_by,created_at').eq('temp_id', t.id).order('created_at', { ascending: false }),
    supabase.from('temp_signatures').select('id,action,signed_name,signed_at,ip,app_documents(kind,version,title)').eq('temp_id', t.id).order('signed_at', { ascending: false }),
    supabase.from('offers').select('id,status,shifts(id,client,shift_date,start_time,end_time)').eq('temp_id', t.id).order('created_at', { ascending: false }).limit(12),
    supabase.from('profiles').select('id,full_name'),
  ]);
  const name = (id: string | null) => (id ? users?.find((u) => u.id === id)?.full_name ?? 'Former consultant' : 'Candidate');
  const admin = profile.role === 'admin';
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const [sk, sl] = STATUS[t.status] ?? ['mute', t.status];
  const rtwExpired = t.rtw_expires && t.rtw_expires < today;

  return (
    <>
      <section className="panel">
        <p className="note" style={{ margin: '0 0 6px' }}><Link href={t.status === 'review' || t.status === 'invited' ? '/registrations' : '/temps'}>← Back</Link></p>
        <h1>{t.first_name} {t.last_name}</h1>
        <div className="btnrow" style={{ marginBottom: 10 }}>
          <span className={`pill ${sk}`}>{sl}</span>
          {t.needs_admin_review && t.status === 'review' && <span className="pill warn">Admin to review</span>}
          {t.rtw_checked_at && !rtwExpired && <span className="pill ok">Right to work checked</span>}
          {rtwExpired && <span className="pill bad">Right to work expired</span>}
          {t.registered_at && (t.bank_on_file ? <span className="pill ok">Bank details on file</span> : <span className="pill warn">No bank details</span>)}
          {t.wa_status === 'yes' && <span className="pill wa">WhatsApp</span>}
        </div>
        <p className="lede" style={{ marginBottom: 0 }}>{displayMobile(t.mobile)}{t.postcode ? ` · ${t.postcode}` : ''} · added by {name(t.added_by)} · {day(t.created_at)}</p>
        <RecordActions
          id={t.id}
          firstName={t.first_name}
          status={t.status}
          registered={!!t.registered_at}
          canApprove={t.status === 'review' && !!t.rtw_checked_at && !rtwExpired && (!t.needs_admin_review || admin)}
          approveBlock={t.status !== 'review' ? '' : !t.rtw_checked_at ? 'Record the right to work check below before approving.' : rtwExpired ? 'Right to work has expired.' : t.needs_admin_review && !admin ? 'An admin needs to approve this candidate.' : ''}
        />
      </section>

      {!t.registered_at ? (
        <section className="panel">
          <h2>Not registered yet</h2>
          <p className="lede" style={{ margin: 0 }}>{t.reg_requested_at ? `Registration link sent ${fmtDateTime(t.reg_requested_at)}. Their details appear here once they’ve filled it in.` : 'This temp was added before online registration. Send them the registration form to collect their details, right to work and agreements.'}</p>
        </section>
      ) : (
        <div className="rec">
          <section className="panel">
            <h2>Details</h2>
            <dl className="kv">
              <dt>Date of birth</dt><dd>{day(p?.dob ?? null)}</dd>
              <dt>Email</dt><dd>{p?.email || '-'}</dd>
              <dt>Address</dt><dd>{[p?.address1, p?.address2, p?.town, t.postcode].filter(Boolean).join(', ')}</dd>
              <dt>NI number</dt><dd>{p?.ni_enc ? <Reveal id={t.id} field="ni" /> : 'Not given'}</dd>
              <dt>Cleared for</dt><dd>{t.job_types.join(', ') || '-'}</dd>
              <dt>Experience</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{p?.experience || '-'}</dd>
              <dt>Available</dt><dd>{p?.availability?.join(', ') || '-'}</dd>
              <dt>Transport</dt><dd>{p?.transport || '-'}</dd>
              <dt>Own PPE</dt><dd>{p?.own_ppe?.join(', ') || 'None'}</dd>
            </dl>
            <h3 style={{ marginTop: 18 }}>Emergency contact</h3>
            <dl className="kv">
              <dt>Name</dt><dd>{p?.nok_name || '-'}{p?.nok_relationship ? ` (${p.nok_relationship})` : ''}</dd>
              <dt>Phone</dt><dd>{p?.nok_phone || '-'}</dd>
            </dl>
          </section>

          <section className="panel">
            <h2>Right to work</h2>
            {t.rtw_checked_at ? (
              <dl className="kv" style={{ marginBottom: 14 }}>
                <dt>Checked</dt><dd>{fmtDateTime(t.rtw_checked_at)} by {name(t.rtw_checked_by)}</dd>
                <dt>Route</dt><dd>{t.rtw_route === 'share_code' ? 'Share code' : 'British or Irish passport'}</dd>
                <dt>Expires</dt><dd>{t.rtw_expires ? <>{day(t.rtw_expires)}{rtwExpired && <span className="pill bad" style={{ marginLeft: 6 }}>Expired</span>}</> : 'No time limit'}</dd>
              </dl>
            ) : <p className="alert" style={{ marginBottom: 14 }}>Not checked yet. They can’t be approved until it is.</p>}
            <RtwCheck id={t.id} route={(t.rtw_route as 'share_code' | 'british_irish') ?? 'share_code'} shareCode={p?.share_code ?? null} dob={p?.dob ?? null} recheck={!!t.rtw_checked_at} />
          </section>

          <section className="panel">
            <h2>Documents</h2>
            <div className="tablewrap" style={{ marginBottom: 12 }}><table>
              <tbody>
                {(docs ?? []).map((d) => (
                  <tr key={d.id}>
                    <td><b>{DOC_KIND_LABEL[d.kind as DocKindFile] ?? d.kind}</b><br /><span className="note">{name(d.uploaded_by)} · {day(d.created_at)}</span></td>
                    <td style={{ textAlign: 'right' }}><a className="btn ghost small" href={`/api/docs/${d.id}`} target="_blank" rel="noopener noreferrer">Open</a></td>
                  </tr>
                ))}
                {!docs?.length && <tr><td className="note">No documents yet.</td></tr>}
              </tbody>
            </table></div>
            <Uploader id={t.id} />
          </section>

          <section className="panel">
            <h2>Agreements</h2>
            <dl className="kv">
              <dt>48-hour week</dt><dd>{p?.wtr_opt_out ? 'Opted out' : 'Limit applies'}{p?.wtr_effective && p.wtr_effective > today ? ` (change takes effect ${day(p.wtr_effective)})` : ''}</dd>
              <dt>Shift messages</dt><dd>{p?.messages_consent ? 'Agreed' : 'Not agreed'}</dd>
              <dt>Signed as</dt><dd>{p?.signature_name} · {p?.signed_at ? fmtDateTime(p.signed_at) : ''}</dd>
            </dl>
            <div className="tablewrap" style={{ marginTop: 12 }}><table>
              <tbody>
                {(sigs ?? []).map((s) => {
                  const d = s.app_documents as unknown as { kind: DocKind; version: number; title: string } | null;
                  const what = s.action === 'wtr_opt_out' ? 'Opted out of 48-hour week' : s.action === 'wtr_withdraw' ? 'Cancelled 48-hour opt-out' : `${d ? DOC_LABEL[d.kind] : 'Document'} v${d?.version ?? '?'}`;
                  return <tr key={s.id}><td>{what}</td><td className="note" style={{ textAlign: 'right' }}>{fmtDateTime(s.signed_at)}{s.ip ? ` · ${s.ip}` : ''}</td></tr>;
                })}
              </tbody>
            </table></div>
          </section>

          <section className="panel">
            <h2>Admin only</h2>
            <p className="note" style={{ marginTop: 0 }}>Encrypted. Each view is recorded in the audit trail.</p>
            <dl className="kv">
              <dt>Health</dt><dd>{admin ? <Reveal id={t.id} field="health" /> : 'Admins only'}</dd>
              <dt>Convictions</dt><dd>{admin ? <Reveal id={t.id} field="convictions" /> : 'Admins only'}</dd>
              <dt>Bank</dt><dd>{p?.bank_last4 ? <>Account ending {p.bank_last4} · added {day(p.bank_added_at)}{admin && <><br /><Reveal id={t.id} field="bank" /></>}</> : 'Not added yet'}</dd>
            </dl>
            <BankActions id={t.id} onFile={t.bank_on_file} admin={admin} />
          </section>

          <section className="panel">
            <h2>Recent shifts</h2>
            <div className="tablewrap"><table>
              <tbody>
                {(offers ?? []).map((o) => {
                  const s = o.shifts as unknown as { id: string; client: string; shift_date: string; start_time: string; end_time: string } | null;
                  return s ? <tr key={o.id}><td><Link href={`/shifts/${s.id}`}>{s.client}</Link><br /><span className="note">{shiftWhen(s)}</span></td><td style={{ textAlign: 'right' }}><span className={`pill ${o.status === 'accepted' ? 'ok' : o.status === 'noshow' ? 'bad' : 'mute'}`}>{OFFER[o.status]}</span></td></tr> : null;
                })}
                {!offers?.length && <tr><td className="note">No shifts offered yet.</td></tr>}
              </tbody>
            </table></div>
          </section>
        </div>
      )}
    </>
  );
}
