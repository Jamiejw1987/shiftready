import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { Logo } from '@/components/Logo';
import { SelfService, type MyRequest } from '../../r/[token]/SelfService';
import { WtrChange } from '../../r/[token]/WtrChange';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My ShiftReady | Staff Selection UK', robots: { index: false } };
const UUID = /^[0-9a-f-]{36}$/i;

/** A temp's own page: holiday and P45 requests, 48-hour choice and bank details. Works for every temp, however long they've been with us. */
export default async function MyPage({ params, searchParams }: { params: { token: string }; searchParams: { do?: string } }) {
  if (!UUID.test(params.token)) notFound();
  const db = createAdminClient();
  const { data: t } = await db.from('temps').select('id,first_name,last_name,status,registered_at,bank_on_file').eq('reg_token', params.token).maybeSingle();
  if (!t) notFound();
  const shell = (body: React.ReactNode) => (
    <main className="tpage"><div className="tbar"><Logo small /></div><div className="tbody">{body}</div></main>
  );
  if (t.status === 'invited' || t.status === 'review')
    return shell(<div className="state"><div className="badge blue">…</div><div className="big">Almost there</div><p>Please finish registering first using the link we texted you. Once you’re approved you can request holiday here.</p>
      <a className="btn blue" href={`/r/${params.token}`}>Go to registration</a></div>);

  const [{ data: prof }, { data: reqs }] = await Promise.all([
    db.from('temp_profiles').select('email,address1,wtr_opt_out,wtr_effective').eq('temp_id', t.id).maybeSingle(),
    db.from('temp_requests').select('id,kind,status,start_date,end_date,days,last_day,delivery,response_note,created_at').eq('temp_id', t.id).order('created_at', { ascending: false }).limit(8),
  ]);
  return shell(
    <>
      <div className="state" style={{ textAlign: 'left', alignItems: 'stretch' }}>
        <div className="big">Hi {t.first_name}</div>
        <p>Request holiday or your P45 here. Keep this link: you can come back to it any time.</p>
        {t.registered_at && !t.bank_on_file && <a className="btn blue" href={`/b/${params.token}`}>Add bank details</a>}
      </div>
      <SelfService token={params.token} requests={(reqs ?? []) as MyRequest[]} hasEmail={!!prof?.email} hasAddress={!!prof?.address1} open={searchParams.do === 'holiday' || searchParams.do === 'p45' ? searchParams.do : ''} />
      {prof && t.registered_at && <WtrChange token={params.token} optedOut={!!prof.wtr_opt_out} effective={prof.wtr_effective} lastName={t.last_name} />}
    </>,
  );
}
