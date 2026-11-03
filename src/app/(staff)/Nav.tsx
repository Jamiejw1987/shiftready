'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function Nav({ admin, waiting = 0, toCheck = 0, clientNew = 0 }: { admin: boolean; waiting?: number; toCheck?: number; clientNew?: number }) {
  const path = usePathname();
  const items = [
    { href: '/temps', label: 'Temps' },
    { href: '/registrations', label: 'Sign-ups' },
    { href: '/planner', label: 'Planner' },
    { href: '/shifts', label: 'Shifts' },
    { href: '/client-requests', label: 'Client requests' },
    { href: '/clients', label: 'Clients' },
    { href: '/requests', label: 'Requests' },
    ...(admin ? [{ href: '/reports', label: 'Reports' }, { href: '/team', label: 'Team' }] : []),
  ];
  return (
    <nav className="nav">
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={(path === i.href || path.startsWith(i.href + '/')) ? 'page' : undefined}>
          {i.label}{i.href === '/requests' && waiting > 0 && <span className="navbadge">{waiting}</span>}{i.href === '/registrations' && toCheck > 0 && <span className="navbadge">{toCheck}</span>}{i.href === '/client-requests' && clientNew > 0 && <span className="navbadge">{clientNew}</span>}
        </Link>
      ))}
    </nav>
  );
}
