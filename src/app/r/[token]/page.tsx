import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { Logo } from '@/components/Logo';
import { currentDocs, docProblems, personalise } from '@/lib/docs';
import { displayMobile } from '@/lib/phone';
import { RegForm } from './RegForm';
import { WtrChange } from './WtrChange';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Register | ShiftReady', robots: { index: false } };
const UUID = /^[0-9a-f-]{36}$/i;

export default async function RegisterPage({ params }: { params: { token: string } }) {
  if (!UUID.test(params.token)) notFound();
  const db = createAdminClient();
  const { data: t } = await db
    .from('temps')
    .select('id,first_name,last_name,mobile,status,job_types,reg_requested_at,registered_at,bank_on_file')
    .eq('reg_token', params.token)
    .maybeSingle();
  if (!t) notFound();

  const shell = (body: React.ReactNode) => (
    <main className="tpage">
      <div className="tbar"><Logo small /></div>
      <div className="tbody">{body}</div>
    </main>
  );

  // Already registered: show where they're up to, and let them change their 48-hour choice.
  if (t.registered_at) {
    const { data: prof } = await db.from('temp_profiles').select('wtr_opt_out,wtr_effective').eq('temp_id', t.id).maybeSingle();
    const waiting = t.status === 'review';
    return shell(
      <>
        <div className="state">
          <div className={`badge ${waiting ? 'blue' : 'ok'}`}>{waiting ? '…' : '✓'}</div>
          <div className="big">{waiting ? 'Thanks, we’re checking your details' : `You’re registered, ${t.first_name}`}</div>
          <p>{waiting
            ? 'A consultant will check your right to work and be in touch. Once you’re approved you’ll start getting shift offers by text or WhatsApp.'
            : t.status === 'active' ? 'You’ll get shift offers near you that match your skills.' : 'Please call the office if you have any questions.'}</p>
          {!waiting && !t.bank_on_file && <a className="btn blue" href={`/b/${params.token}`}>Add bank details</a>}
        </div>
        {prof && <WtrChange token={params.token} optedOut={!!prof.wtr_opt_out} effective={prof.wtr_effective} lastName={t.last_name} />}
      </>,
    );
  }

  const open = t.status === 'invited' || t.reg_requested_at;
  if (!open) return shell(<div className="state"><div className="badge mute">–</div><div className="big">Link not active</div><p>Please call the office.</p></div>);

  const docs = await currentDocs(db);
  if (docProblems(docs).length)
    return shell(<div className="state"><div className="badge mute">–</div><div className="big">Registration opens soon</div><p>We’re just finishing setting up. Please try your link again later, or call the office.</p></div>);

  const who = { first: t.first_name, last: t.last_name === '-' ? '' : t.last_name };
  return shell(
    <RegForm
      token={params.token}
      first={t.first_name}
      last={t.last_name === '-' ? '' : t.last_name}
      mobile={displayMobile(t.mobile)}
      jobTypes={t.job_types ?? []}
      docs={{
        kid: { title: docs.kid!.title, body: personalise(docs.kid!.body, who) },
        terms: { title: docs.terms!.title, body: personalise(docs.terms!.body, who) },
        privacy: { title: docs.privacy!.title, body: personalise(docs.privacy!.body, who) },
        wtr: { title: docs.wtr!.title, body: personalise(docs.wtr!.body, who) },
      }}
    />,
  );
}
