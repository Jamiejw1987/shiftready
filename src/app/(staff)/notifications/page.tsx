import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { fmtDateTime } from '@/lib/format';
import { displayMobile } from '@/lib/phone';
import { AlertSettings } from './AlertSettings';

export const dynamic = 'force-dynamic';

export default async function Notifications() {
  const { supabase, profile } = await requireStaff();
  const { data: items } = await supabase.from('staff_notifications').select('id,kind,title,body,link,urgent,created_at').order('created_at', { ascending: false }).limit(100);
  const seen = profile.notif_seen_at ?? '1970-01-01';
  // Opening this page marks everything as read for you (only your own record changes).
  await createAdminClient().from('profiles').update({ notif_seen_at: new Date().toISOString() }).eq('id', profile.id);
  return (
    <>
      <section className="panel">
        <h1>Alerts</h1>
        <p className="lede">New client requests, changes and cancellations, client no-shows and blocks. The latest 100.</p>
        {(items ?? []).map((n) => (
          <div key={n.id} className={`notif${n.created_at > seen ? ' new' : ''}`}>
            <span className="note">{fmtDateTime(n.created_at)}{n.urgent && <> · <span className="pill warn">Urgent</span></>}</span>
            <span>{n.link ? <Link href={n.link}><b>{n.title}</b></Link> : <b>{n.title}</b>}</span>
            {n.body && <span className="note">{n.body}</span>}
          </div>
        ))}
        {!items?.length && <p className="note">Nothing yet.</p>}
      </section>
      <section className="panel">
        <h2>How you get client alerts</h2>
        <p className="lede">New requests, changes to date, time or numbers, and cancellations are sent to everyone in the office.</p>
        <dl className="kv" style={{ marginBottom: 12 }}>
          <dt>Text</dt><dd>{profile.mobile ? (profile.client_sms_alerts !== false ? `On, to ${displayMobile(profile.mobile)}` : 'Switched off by an admin') : 'No mobile on your account. Ask an admin to add it on the Team page.'}</dd>
          <dt>Email</dt><dd>{profile.client_email_alerts !== false ? `On, to ${profile.email}` : 'Muted'}</dd>
        </dl>
        <AlertSettings emailOn={profile.client_email_alerts !== false} />
      </section>
    </>
  );
}
