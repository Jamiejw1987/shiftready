import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { currentDocs, DOC_LABEL, gapsIn, type DocKind } from '@/lib/docs';
import { fmtDateTime } from '@/lib/format';
import { DocEditor } from './DocEditor';

export const dynamic = 'force-dynamic';

const HELP: Record<DocKind, string> = {
  kid: 'Required by law before a temp agrees terms with you. Use {full_name} and {date} and they’re filled in for each candidate.',
  terms: 'The contract for services every temp signs. Use {full_name} and {date} as placeholders.',
  privacy: 'Explains how you use candidates’ data. Shown during registration.',
  wtr: 'The wording shown when a candidate chooses to opt out of the 48-hour week.',
};

export default async function DocumentsPage() {
  const { supabase } = await requireStaff({ admin: true });
  const docs = await currentDocs(supabase);
  return (
    <>
      <section className="panel">
        <p className="note" style={{ margin: '0 0 6px' }}><Link href="/team">← Team</Link></p>
        <h1>Documents</h1>
        <p className="lede" style={{ marginBottom: 0 }}>What candidates read and sign when they register. Saving a change creates a new version: everyone who already signed keeps their record of the version they agreed to. Have your employment adviser check these before you go live.</p>
      </section>
      {(['kid', 'terms', 'privacy', 'wtr'] as DocKind[]).map((k) => {
        const d = docs[k];
        const gaps = d ? gapsIn(d.body) : [];
        return (
          <section className="panel" key={k}>
            <h2>{DOC_LABEL[k]}</h2>
            <p className="lede">{HELP[k]} {d ? `Version ${d.version}, saved ${fmtDateTime(d.created_at)}.` : 'Not added yet.'}</p>
            {gaps.length > 0 && <p className="alert" style={{ marginBottom: 12 }}>Fill these gaps before registration can open: {gaps.join(', ')}</p>}
            <DocEditor kind={k} title={d?.title ?? DOC_LABEL[k]} body={d?.body ?? ''} />
          </section>
        );
      })}
    </>
  );
}
