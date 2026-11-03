'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function PortalNav() {
  const path = usePathname();
  const items = [
    { href: '/portal', label: 'Shifts', on: path === '/portal' || path.startsWith('/portal/requests') },
    { href: '/portal/new', label: 'Request a shift', on: path === '/portal/new' },
    { href: '/portal/account', label: 'Account', on: path === '/portal/account' },
  ];
  return (
    <nav className="nav">
      {items.map((i) => <Link key={i.href} href={i.href} aria-current={i.on ? 'page' : undefined}>{i.label}</Link>)}
    </nav>
  );
}
