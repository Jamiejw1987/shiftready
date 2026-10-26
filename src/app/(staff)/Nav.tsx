'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function Nav({ admin }: { admin: boolean }) {
  const path = usePathname();
  const items = [
    { href: '/temps', label: 'Temps' },
    { href: '/registrations', label: 'Sign-ups' },
    { href: '/shifts', label: 'Shifts' },
    { href: '/requests', label: 'Requests' },
    ...(admin ? [{ href: '/team', label: 'Team' }] : []),
  ];
  return (
    <nav className="nav">
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={(path === i.href || path.startsWith(i.href + '/')) ? 'page' : undefined}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
