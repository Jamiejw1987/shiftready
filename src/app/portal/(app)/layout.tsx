import { Logo } from '@/components/Logo';
import { requireClient } from '@/lib/portalAuth';
import { PortalNav } from '../ui/PortalNav';
import { signOutPortal } from '../actions';

export const dynamic = 'force-dynamic';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { user, client } = await requireClient();
  const initials = (user.full_name ?? user.email).split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return (
    <>
      <header className="band">
        <div className="band-in">
          <div className="band-logo"><Logo /></div>
          <div className="band-nav"><PortalNav /></div>
          <div className="user">
            <span className="avatar" aria-hidden="true">{initials}</span>
            <span className="who">
              <b>{user.full_name}</b>
              <span className="role">{client.name}</span>
            </span>
            <form action={signOutPortal}><button className="btn signout">Sign out</button></form>
          </div>
        </div>
      </header>
      <main className="wrap">
        {client.is_test && <p className="alert" style={{ marginBottom: 12 }}>Test client: requests here are for trying the portal out.</p>}
        {children}
      </main>
    </>
  );
}
