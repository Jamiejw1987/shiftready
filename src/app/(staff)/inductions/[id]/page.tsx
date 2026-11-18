import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadFull } from '@/lib/inductionLoad';
import { STATUS_PILL, fmtDay, fmtStamp, progress, statusOf, visiblePages } from '@/lib/inductions';
import { InductionButtons, StaffSiteUpload, StaffMh, StaffDayOne } from '../Controls';
import { hasDayOneForm } from '@/lib/dayOne';
import { hasMhSheets } from '@/lib/mhAssessment';

export const dynamic = 'force-dynamic';

export default async function InductionReview({ params }: { params: { id: string } }) {
  const { supabase } = await requireStaff();
  const { data: ok } = await supabase.from('temp_inductions').select('id').eq('id', params.id).maybeSingle();
  if (!ok) notFound();
  const db = createAdminClient();
  const f = await loadFull(db, params.id);
  if (!f) notFound();
  const { induction: i, pack, temp, docs, marks, siteFiles } = f;
  const st = statusOf(i);
  const [pk, pl] = STATUS_PILL[st];
  const p = progress(docs, marks);
  const ids = [i.sent_by, i.checked_by, i.site_by_staff].filter(Boolean) as string[];
  const [{ data: staff }, { data: sup }] = await Promise.all([
    ids.length ? db.from('profiles').select('id,full_name').in('id', ids) : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    i.site_by_supervisor ? db.from('site_supervisors').select('full_name').eq('id', i.site_by_supervisor).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const nm = (id: string | null) => (staff ?? []).find((s) => s.id === id)?.full_name ?? '';
  const a = i.answers ?? {};
  const mk = new Map(marks.map((m) => [`${m.doc_id}:${m.page}`, m]));
  const sigs = marks.filter((m) => m.signature).sort((x, y) => x.at.localeCompare(y.at));
  const mhOn = await hasMhSheets(db, i);
  const formOn = await hasDayOneForm(db, i);
  const { data: mhDone } = mhOn ? await db.from('induction_assessments').select('trainer_name,at').eq('induction_id', i.id).eq('kind', 'mh_practical').order('at', { ascending: false }).limit(1).maybeSingle() : { data: null };
  const { data: me } = await supabase.auth.getUser();
  const { data: myProfile } = me.user ? await supabase.from('profiles').select('full_name').eq('id', me.user.id).maybeSingle() : { data: null };

  return (
    <>
      <section className="panel">
        <p className="note" style={{ margin: '0 0 6px' }}><Link href={`/temps/${temp.id}`}>← {temp.first_name} {temp.last_name}</Link></p>
        <h1>{pack.name}</h1>
        <div className="btnrow" style={{ marginBottom: 10 }}>
          <span className={`pill ${pk}`}>{pl}</span>
          <span className="pill mute">{p.done} of {p.total} pages and signatures</span>
          {a.footwear === false && <span className="pill bad">Said they have no safety footwear</span>}
        </div>
        <dl className="kv" style={{ marginBottom: 14 }}>
          <dt>Worker</dt><dd>{temp.first_name} {temp.last_name}</dd>
          <dt>Site</dt><dd>{a.site || pack.default_site || '-'}</dd>
          <dt>Scope of work</dt><dd>{a.scope || pack.default_scope || '-'}</dd>
          <dt>Start date</dt><dd>{a.startDate ? fmtDay(a.startDate) : '-'}</dd>
          <dt>Arrival time</dt><dd>{a.arrival || pack.default_arrival || '-'}</dd>
          <dt>Safety footwear</dt><dd>{a.footwear == null ? 'Not answered yet' : a.footwear ? 'Yes' : 'No'}</dd>
          <dt>Sent</dt><dd>{fmtStamp(i.sent_at)}{i.sent_by ? ` by ${nm(i.sent_by)}` : ''}</dd>
          <dt>Signed by worker</dt><dd>{i.signed_at ? `${fmtStamp(i.signed_at)}${i.signed_ip ? ` · IP ${i.signed_ip}` : ''}` : '-'}</dd>
          <dt>Signatures checked</dt><dd>{i.checked_at ? `${fmtStamp(i.checked_at)} by ${nm(i.checked_by)}` : '-'}</dd>
          <dt>Day-one sign-off</dt><dd>{i.site_signed_at ? `${fmtStamp(i.site_signed_at)} by ${sup?.full_name ? `${sup.full_name} (site login)` : nm(i.site_by_staff)}` : 'Not uploaded yet'}</dd>
        </dl>
        <InductionButtons id={i.id} status={st} full details={{ site: a.site ?? '', scope: a.scope ?? '', startDate: a.startDate ?? '', arrival: a.arrival ?? '' }} />
      </section>

      {sigs.length > 0 && (
        <section className="panel">
          <h2>Check the signatures</h2>
          <p className="lede">Every signature and set of initials they gave, in order. They should look like the same person. If any are just a line or a scribble, use <b>Make them sign again</b>.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
            {sigs.map((m) => {
              const d = docs.find((x) => x.id === m.doc_id);
              return (
                <figure key={`${m.doc_id}:${m.page}`} style={{ margin: 0 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="sigimg" src={m.signature!} alt="Signature" />
                  <figcaption className="note">{d?.title ?? 'Document'}{m.page ? `, page ${m.page}` : ', end'}<br />{fmtStamp(m.at)}</figcaption>
                </figure>
              );
            })}
          </div>
        </section>
      )}

      {mhOn && st !== 'cancelled' && (
        <section className="panel">
          <h2>Manual handling assessment</h2>
          {mhDone ? <p className="okmsg">✓ Done {fmtStamp(mhDone.at)}, trainer {mhDone.trainer_name}. It’s on their file and in the signed PDF.</p>
            : <><p className="lede">Done in person on day one, usually from the site login. If you’re with them, you can do it here.</p>
              <StaffMh id={i.id} candidate={`${temp.first_name} ${temp.last_name}`} location={a.site || pack.default_site || ''} trainer={myProfile?.full_name ?? ''} /></>}
        </section>
      )}

      <section className="panel">
        <h2>Day-one sign-off on site</h2>
        {i.site_signed_at ? <p className="okmsg">✓ Done {fmtStamp(i.site_signed_at)}. It’s on their file and in the signed PDF.</p>
          : <p className="lede">Done on site on day one, usually from the site login: they initial each point on DHL’s form, then they and your site person sign. If you’re with them, do it here.</p>}
        {!i.site_signed_at && formOn && st !== 'cancelled' && i.signed_at && <div style={{ marginBottom: 12 }}><StaffDayOne id={i.id} candidate={`${temp.first_name} ${temp.last_name}`} rep={myProfile?.full_name ?? ''} /></div>}
        {siteFiles.length > 0 && <div className="tablewrap" style={{ marginBottom: 12 }}><table><tbody>
          {siteFiles.map((s) => <tr key={s.id}><td>{s.kind === 'mh_assessment' ? 'Manual handling assessment' : s.filename ?? 'Photo'}<br /><span className="note">{fmtStamp(s.created_at)}</span></td><td style={{ textAlign: 'right' }}><a className="btn ghost small" href={`/api/docs/${s.id}`} target="_blank" rel="noopener noreferrer">Open</a></td></tr>)}
        </tbody></table></div>}
        {st !== 'cancelled' && !i.site_signed_at && <details><summary className="note" style={{ cursor: 'pointer' }}>Done it on paper instead? Upload a photo</summary><div style={{ marginTop: 8 }}><StaffSiteUpload id={i.id} /></div></details>}
      </section>

      <section className="panel">
        <h2>Page by page</h2>
        <div className="tablewrap"><table>
          <tbody>
            {docs.filter((d) => d.in_app).map((d) => (
              <tr key={d.id}>
                <td><b>{d.title}</b><br /><span className="note">
                  {visiblePages(d).map((n) => (mk.get(`${d.id}:${n}`)?.read_ok && mk.get(`${d.id}:${n}`)?.understood_ok ? '✓' : '·')).join(' ')}
                </span></td>
                <td className="note" style={{ textAlign: 'right' }}>{(() => {
                  const last = d.sign_mode === 'document' ? mk.get(`${d.id}:0`) : mk.get(`${d.id}:${visiblePages(d).at(-1)}`);
                  return last?.signature ? `Signed ${fmtStamp(last.at)}` : 'Not signed';
                })()}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </section>
    </>
  );
}
