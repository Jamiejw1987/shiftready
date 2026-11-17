import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { Logo } from '@/components/Logo';
import { IND_COLS, docsFor, fmtDay, visiblePages, type Mark, type TempInduction } from '@/lib/inductions';
import { Flow, type FlowDoc } from './Flow';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Induction | ShiftReady', robots: { index: false } };
const UUID = /^[0-9a-f-]{36}$/i;

export default async function InductionPage({ params }: { params: { token: string } }) {
  if (!UUID.test(params.token)) notFound();
  const db = createAdminClient();
  const { data } = await db.from('temp_inductions').select(IND_COLS).eq('token', params.token).maybeSingle();
  const i = data as TempInduction | null;
  if (!i) notFound();

  const shell = (body: React.ReactNode) => (
    <main className="tpage"><div className="tbar"><Logo small /></div><div className="tbody">{body}</div></main>
  );
  const [{ data: t }, { data: pack }] = await Promise.all([
    db.from('temps').select('first_name,last_name').eq('id', i.temp_id).single(),
    db.from('induction_packs').select('name,default_site,default_scope,default_arrival').eq('id', i.pack_id).single(),
  ]);
  if (i.cancelled_at || !t || !pack)
    return shell(<div className="state"><div className="badge mute">–</div><div className="big">Link not active</div><p>Please call the office.</p></div>);
  if (i.signed_at)
    return shell(
      <div className="state">
        <div className="badge ok">✓</div>
        <div className="big">All signed, {t.first_name}</div>
        <p>Thanks for completing the {pack.name}. On your first day, someone will show you around site and you’ll sign one last sheet on paper.</p>
        <p>Bring: safety boots, your hi-vis, gloves, photo ID and a padlock for your locker.</p>
      </div>,
    );

  const docs = (await docsFor(db, i.doc_ids)).filter((d) => d.in_app);
  const { data: marks } = await db.from('induction_marks').select('doc_id,page,read_ok,understood_ok,signature').eq('induction_id', i.id);
  const all = docs.flatMap((d) => visiblePages(d).map((n) => d.page_images[n - 1]).filter(Boolean));
  const { data: urls } = all.length ? await db.storage.from('documents').createSignedUrls(all, 6 * 3600) : { data: [] };
  const url = new Map((urls ?? []).map((u) => [u.path, u.signedUrl]));
  const flowDocs: FlowDoc[] = docs.map((d) => ({
    id: d.id, title: d.title, signMode: d.sign_mode, hasForm: !!d.template,
    pages: visiblePages(d).map((n) => ({ n, url: url.get(d.page_images[n - 1] ?? '') ?? '', w: d.page_sizes[n - 1]?.[0] ?? 595, h: d.page_sizes[n - 1]?.[1] ?? 842 })),
  }));
  const a = i.answers ?? {};

  return shell(
    <Flow
      token={params.token}
      first={t.first_name}
      name={`${t.first_name} ${t.last_name}`}
      packName={pack.name}
      details={{ site: a.site || pack.default_site || '', scope: a.scope || pack.default_scope || '', start: a.startDate ? fmtDay(a.startDate) : '', arrival: a.arrival || pack.default_arrival || '' }}
      footwear={a.footwear ?? null}
      docs={flowDocs}
      done={((marks ?? []) as Mark[]).map((m) => ({ docId: m.doc_id, page: m.page, ok: m.page === 0 ? !!m.signature : m.read_ok && m.understood_ok, signed: !!m.signature }))}
    />,
  );
}
