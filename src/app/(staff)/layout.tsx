import { requireStaff } from '@/lib/auth';
import { Logo } from '@/components/Logo';
import { Nav } from './Nav';
import { signOut } from './actions';

export const dynamic = 'force-dynamic';

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireStaff();
  const initials = profile.full_name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return (
    <>
      <header className="band">
        <div className="band-in">
          <div className="band-logo"><Logo /></div>
          <div className="band-nav"><Nav admin={profile.role === 'admin'} /></div>
          <div className="user">
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
