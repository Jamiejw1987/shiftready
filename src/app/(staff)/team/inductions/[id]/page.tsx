import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { activeDocs, templateLabel } from '@/lib/inductions';
import { PackForm, DocUploader, DocRow } from '../InductionAdmin';

export const dynamic = 'force-dynamic';

export default async function PackPage({ params }: { params: { id: string } }) {
  const { supabase } = await requireStaff({ admin: true });
  const { data: p } = await supabase.from('induction_packs').select('*').eq('id', params.id).maybeSingle();
  if (!p) notFound();
  const [docs, { data: clients }] = await Promise.all([
    activeDocs(supabase, p.id),
    supabase.from('clients').select('id,name').eq('active', true).order('name'),
  ]);
  const firsts = docs.map((d) => d.page_images[0]).filter(Boolean);
  const { data: urls } = firsts.length ? await createAdminClient().storage.from('documents').createSignedUrls(firsts, 3600) : { data: [] };
  const url = (path?: string) => (urls ?? []).find((u) => u.path === path)?.signedUrl ?? null;
  const inApp = docs.filter((d) => d.in_app);
  const sitePrint = docs.filter((d) => d.site_pages.length);

  return (
    <>
      <section className="panel">
        <p className="note" style={{ margin: '0 0 6px' }}><Link href="/team/inductions">← Client inductions</Link></p>
        <h1>{p.name}</h1>
        <PackForm clients={(clients ?? []).map((c) => ({ id: c.id, name: c.name }))} pack={{
          id: p.id, active: p.active, name: p.name, clientId: p.client_id ?? '', site: p.default_site ?? '', scope: p.default_scope ?? '', arrival: p.default_arrival ?? '', agency: p.agency_name,
        }} />
      </section>

      <section className="panel">
        <h2>Documents, in order</h2>
        <p className="lede">The client’s PDFs exactly as supplied. Temps go through them in this order: {inApp.length} document{inApp.length === 1 ? '' : 's'}, {inApp.reduce((n, d) => n + d.page_count - d.hidden_pages.length, 0)} pages.
          {sitePrint.length > 0 && <> Day-one paper sheets: {sitePrint.map((d) => `${d.title} (page${d.site_pages.length === 1 ? '' : 's'} ${d.site_pages.join(', ')})`).join('; ')}.</>}</p>
        <div className="tablewrap" style={{ marginBottom: 14 }}><table>
          <tbody>
            {docs.map((d, i) => (
              <DocRow key={d.id} first={i === 0} last={i === docs.length - 1} d={{
                id: d.id, title: d.title, page_count: d.page_count, in_app: d.in_app, sign_mode: d.sign_mode, site_pages: d.site_pages, hidden_pages: d.hidden_pages,
                template: d.template, templateLabel: templateLabel(d.template), preview: url(d.page_images[0]),
              }} />
            ))}
            {!docs.length && <tr><td className="note">No documents yet. Add the client’s PDFs below.</td></tr>}
          </tbody>
        </table></div>
        <DocUploader packId={p.id} />
        <p className="note" style={{ marginTop: 14 }}>Changes apply to inductions sent from now on. Anything already sent keeps the pack exactly as it was.</p>
      </section>
    </>
  );
}
