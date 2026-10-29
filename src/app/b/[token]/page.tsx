import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { Logo } from '@/components/Logo';
import { BankForm } from './BankForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Bank details | ShiftReady', robots: { index: false } };
const UUID = /^[0-9a-f-]{36}$/i;

export default async function BankPage({ params }: { params: { token: string } }) {
  if (!UUID.test(params.token)) notFound();
  const db = createAdminClient();
  const { data: t } = await db.from('temps').select('id,first_name,status,bank_on_file').eq('reg_token', params.token).maybeSingle();
  if (!t) notFound();
  let last4: string | null = null;
  if (t.bank_on_file) {
    const { data: p } = await db.from('temp_profiles').select('bank_last4').eq('temp_id', t.id).maybeSingle();
    last4 = p?.bank_last4 ?? null;
  }
  return (
    <main className="tpage">
      <div className="tbar"><Logo small /></div>
      <div className="tbody">
        {t.status === 'invited' || t.status === 'review' ? (
          <div className="state"><div className="badge mute">–</div><div className="big">Register first</div><p>Please finish your registration using the link we texted you, then add your bank details.</p>
            <a className="btn blue" href={`/r/${params.token}`}>Go to registration</a></div>
        ) : t.bank_on_file ? (
          <div className="state"><div className="badge ok">✓</div><div className="big">Bank details saved</div>
            <p>We’ll pay you into the account ending {last4 ?? '****'}. To change your bank details, please call the office.</p></div>
        ) : (
          <BankForm token={params.token} first={t.first_name} />
        )}
      </div>
    </main>
  );
}
