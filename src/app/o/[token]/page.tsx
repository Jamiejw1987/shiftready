import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { Logo } from '@/components/Logo';
import { optIn, optOut } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'ShiftReady | Staff Selection UK' };
const UUID = /^[0-9a-f-]{36}$/i;

export default async function OptInPage({ params }: { params: { token: string } }) {
  if (!UUID.test(params.token)) notFound();
  const db = createAdminClient();
  const { data: t } = await db.from('temps').select('first_name,postcode,status').eq('optin_token', params.token).maybeSingle();
  if (!t) notFound();

  const yes = optIn.bind(null, params.token);
  const no = optOut.bind(null, params.token);

  return (
    <main className="tpage">
      <div className="tbar"><Logo small /></div>
      <div className="tbody">
        {t.status === 'active' || t.status === 'hold' ? (
          <div className="state">
            <div className="badge ok">✓</div>
            <div className="big">You’re all set, {t.first_name}</div>
            <p>We’ll text you shift offers near {t.postcode} that match your skills. Reply STOP to any text if you no longer want them.</p>
            <form action={no}><button className="btn ghost">Stop shift texts</button></form>
          </div>
        ) : t.status === 'out' ? (
          <div className="state">
            <div className="badge mute">–</div>
            <div className="big">You’ve opted out</div>
            <p>You won’t receive shift texts from Staff Selection UK.</p>
            <form action={yes}><button className="btn blue">Opt back in</button></form>
          </div>
        ) : (
          <div className="state">
            <div className="big">Hi {t.first_name}, welcome to Staff Selection UK</div>
            <p>Are you happy to receive shift offers from us by text? We’ll only send shifts near {t.postcode} that match your skills. You can stop at any time.</p>
            <div className="stack">
              <form action={yes}><button className="btn blue">Yes, send me shifts</button></form>
              <form action={no}><button className="btn ghost">No thanks</button></form>
            </div>
            <p className="note">Staff Selection UK uses your name, mobile and postcode to offer you work. Contact us to see or delete your data.</p>
          </div>
        )}
      </div>
    </main>
  );
}
