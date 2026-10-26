import { requireStaff } from '@/lib/auth';
import { Logo } from '@/components/Logo';
import { Nav } from './Nav';
import { signOut } from './actions';

export const dynamic = 'force-dynamic';

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireStaff();
  return (
    <>
      <header className="band">
        <div className="band-in">
          <Logo />
          <Nav admin={profile.role === 'admin'} />
          <div className="user">
            <span><b>{profile.full_name}</b> <span className="pill blue">{profile.role === 'admin' ? 'Admin' : 'Consultant'}</span></span>
            <form action={signOut}><button className="btn">Sign out</button></form>
          </div>
        </div>
      </header>
      <main className="wrap">{children}</main>
    </>
  );
}
