import { redirect } from 'next/navigation';
import { ClientBrand } from '@/components/ClientMark';
import { requireClient } from '@/lib/portalAuth';
import { displayMobile } from '@/lib/phone';
import { ProfileForm } from '../ui/ProfileForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Welcome | ShiftReady for clients' };

/** First sign-in: a few details so Staff Selection knows who's booking. */
export default async function Welcome() {
  const { user, client, sites } = await requireClient({ allowIncomplete: true });
  if (user.full_name && user.mobile && user.job_title) redirect('/portal');
  return (
    <main className="center">
      <div className="lcard">
        <ClientBrand name={client.name} logo={client.logo} />
        <h1>Welcome to ShiftReady</h1>
        <p className="lede" style={{ margin: 0 }}>You’re set up for <b>{client.name}</b>. Add a few details so our team knows who they’re working with.</p>
        <ProfileForm first done="/portal" sites={sites} mySiteIds={sites.map((s) => s.id)}
          initial={{ fullName: user.full_name ?? '', mobile: user.mobile ? displayMobile(user.mobile) : '', jobTitle: user.job_title ?? '' }} />
      </div>
    </main>
  );
}
