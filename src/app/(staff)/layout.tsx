import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { Logo } from '@/components/Logo';
import { Nav } from './Nav';
import { signOut } from './actions';

export const dynamic = 'force-dynamic';

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const { supabase, profile } = await requireStaff();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const [{ count: waiting }, { count: toCheck }, { count: clientNew }, { count: unread }] = await Promise.all([
    supabase.from('temp_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('temps').select('id', { count: 'exact', head: true }).eq('status', 'review'),
    supabase.from('client_requests').select('id', { count: 'exact', head: true }).eq('status', 'submitted').gte('request_date', today),
    supabase.from('staff_notifications').select('id', { count: 'exact', head: true }).gt('created_at', profile.notif_seen_at ?? '1970-01-01'),
  ]);
  const initials = profile.full_name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return (
    <>
      <header className="band">
        <div className="band-in">
          <div className="band-logo"><Logo /></div>
          <div className="band-nav"><Nav admin={profile.role === 'admin'} waiting={waiting ?? 0} toCheck={toCheck ?? 0} clientNew={clientNew ?? 0} /></div>
          <div className="user">
            <Link href="/notifications" className={`bell${unread ? ' hot' : ''}`} aria-label={unread ? `${unread} new alerts` : 'Alerts'}>
              <span aria-hidden="true">🔔</span>{unread ? <span className="navbadge">{unread > 99 ? '99+' : unread}</span> : null}
            </Link>
            <span className="avatar" aria-hidden="true">{initials}</span>
            <span className="who">
              <b>{profile.full_name}</b>
              <span className="role">{profile.role === 'admin' ? 'Admin' : 'Consultant'}</span>
            </span>
            <form action={signOut}><button className="btn signout">Sign out</button></form>
          </div>
        </div>
      </header>
      <main className="wrap">{children}</main>
    </>
  );
}
