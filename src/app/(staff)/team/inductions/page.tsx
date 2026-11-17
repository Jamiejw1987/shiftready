import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { PackForm, Supervisors } from './InductionAdmin';

export const dynamic = 'force-dynamic';

export default async function InductionsPage() {
  const { supabase } = await requireStaff({ admin: true });
  const [{ data: packs, error }, { data: docs }, { data: clients }, { data: sups }, { data: sent }] = await Promise.all([
    supabase.from('induction_packs').select('id,name,active,client_id,clients(name)').order('created_at'),
    supabase.from('induction_docs').select('pack_id,page_count,in_app').is('archived_at', null),
    supabase.from('clients').select('id,name').eq('active', true).order('name'),
    createAdminClient().from('site_supervisors').select('id,username,full_name,client_id,active,last_login_at').order('full_name'),
    supabase.from('temp_inductions').select('pack_id').is('cancelled_at', null),
  ]);
  const clientOptions = (clients ?? []).map((c) => ({ id: c.id, name: c.name }));

  return (
    <>
      <section className="panel">
        <p className="note" style={{ margin: '0 0 6px' }}><Link href="/team">← Team</Link></p>
        <h1>Client inductions</h1>
        <p className="lede">A client’s induction pack, kept exactly as they supplied it. Temps read every page on their phone, tick that they’ve read and understood it, and sign with their finger. You check the signatures, then the day-one sign-off is done on paper on site and photographed in.</p>
        {error && <p className="alert">Run <b>supabase/2026-11-17-inductions.sql</b> in Supabase (SQL Editor) to switch this on.</p>}
        <div className="tablewrap"><table>
          <tbody>
            {(packs ?? []).map((p) => {
              const d = (docs ?? []).filter((x) => x.pack_id === p.id);
              return (
                <tr key={p.id}>
                  <td><Link href={`/team/inductions/${p.id}`}><b>{p.name}</b></Link><br />
                    <span className="note">{(p.clients as unknown as { name: string } | null)?.name ?? 'Any client'} · {d.length} document{d.length === 1 ? '' : 's'}, {d.filter((x) => x.in_app).reduce((n, x) => n + x.page_count, 0)} pages to read · sent to {(sent ?? []).filter((s) => s.pack_id === p.id).length}</span></td>
                  <td style={{ textAlign: 'right' }}>{p.active ? <span className="pill ok">On</span> : <span className="pill mute">Off</span>}</td>
                </tr>
              );
            })}
            {!packs?.length && <tr><td className="note">No induction packs yet.</td></tr>}
          </tbody>
        </table></div>
      </section>

      <section className="panel">
        <h2>New induction pack</h2>
        <PackForm clients={clientOptions} />
      </section>

      <section className="panel">
        <h2>Site supervisor logins</h2>
        <p className="lede">For whoever runs day one on site for you. They sign in at <b>/site</b> with a username and password, see only the temps booked on today’s shifts, and upload the photo of each signed day-one sheet. They can’t see anything else.</p>
        <Supervisors list={(sups ?? []).map((s) => ({ ...s, client: clientOptions.find((c) => c.id === s.client_id)?.name ?? null }))} clients={clientOptions} />
      </section>
    </>
  );
}
