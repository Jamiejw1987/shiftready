import Link from 'next/link';
import { requireClient } from '@/lib/portalAuth';
import { displayMobile } from '@/lib/phone';
import { ProfileForm } from '../../ui/ProfileForm';
import { Templates } from './Templates';

export const dynamic = 'force-dynamic';

export default async function Account() {
  const { supabase, user, client, sites } = await requireClient();
  const { data: templates } = await supabase.from('client_templates').select('id,name,site_id,start_time,end_time,role,headcount').eq('client_id', client.id).order('name');
  return (
    <>
      <section className="panel">
        <h1>Your details</h1>
        <p className="lede">{user.email} · {client.name} · {sites.length === 1 ? 'Site' : 'Sites'}: {sites.map((s) => s.name).join(', ') || 'none yet'}. Ask Staff Selection to change your sites.</p>
        <div style={{ maxWidth: 520 }}>
          <ProfileForm first={false} done="/portal/account" sites={[]} mySiteIds={[]}
            initial={{ fullName: user.full_name ?? '', mobile: user.mobile ? displayMobile(user.mobile) : '', jobTitle: user.job_title ?? '' }} />
        </div>
      </section>
      <section className="panel">
        <h2>Saved shifts</h2>
        <p className="lede">Shifts you request regularly. Pick one on <Link href="/portal/new">Request a shift</Link> to fill in the form for you.</p>
        <Templates items={(templates ?? []).filter((t) => sites.some((s) => s.id === t.site_id)).map((t) => ({
          id: t.id, name: t.name, detail: `${sites.find((s) => s.id === t.site_id)?.name ?? ''} · ${t.start_time.slice(0, 5)}-${t.end_time.slice(0, 5)} · ${t.headcount} × ${t.role}`,
        }))} />
      </section>
      <section className="panel">
        <h2>Use it like an app</h2>
        <p className="lede" style={{ margin: 0 }}>On iPhone, tap Share then <b>Add to Home Screen</b>. On Android, tap the menu then <b>Install app</b> or <b>Add to Home screen</b>. You’ll stay signed in on this phone.</p>
      </section>
      <section className="panel">
        <h2>Your privacy</h2>
        <p className="lede" style={{ margin: 0 }}>Staff Selection UK keeps your name, work email, mobile, job title and what you do here, to run your shift bookings and to stay in touch with you about our services. Workers’ contact details are never shown here: please contact our team about anyone booked. Questions about your data: info@staffselectionuk.com.</p>
      </section>
    </>
  );
}
