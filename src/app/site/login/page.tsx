import { redirect } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { currentSupervisor } from '@/lib/siteAuth';
import { SiteLoginForm } from '../SiteClient';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Site sign-in | ShiftReady', robots: { index: false } };

export default async function SiteLogin() {
  if (await currentSupervisor()) redirect('/site');
  return (
    <main className="tpage"><div className="tbar"><Logo small /></div><div className="tbody">
      <section className="card"><div className="in">
        <h1 style={{ margin: 0 }}>Site sign-in</h1>
        <p className="note" style={{ margin: 0 }}>For site supervisors uploading day-one induction sign-offs. Office staff sign in at the normal page.</p>
        <SiteLoginForm />
      </div></section>
    </div></main>
  );
}
