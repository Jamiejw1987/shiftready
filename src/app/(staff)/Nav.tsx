'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

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
  const ref = useRef<HTMLElement>(null);

  // On narrow screens the tabs scroll sideways: keep the current tab in view and
  // show a fade on whichever edge has more tabs hidden behind it.
  useEffect(() => {
    const nav = ref.current;
    const box = nav?.parentElement;
    if (!nav || !box) return;
    const edges = () => {
      const max = nav.scrollWidth - nav.clientWidth;
      box.toggleAttribute('data-more-l', nav.scrollLeft > 2);
      box.toggleAttribute('data-more-r', nav.scrollLeft < max - 2);
    };
    const cur = nav.querySelector<HTMLElement>('[aria-current="page"]');
    if (cur && nav.scrollWidth > nav.clientWidth) {
      nav.scrollLeft = cur.offsetLeft - (nav.clientWidth - cur.offsetWidth) / 2;
    }
    edges();
    nav.addEventListener('scroll', edges, { passive: true });
    window.addEventListener('resize', edges);
    return () => { nav.removeEventListener('scroll', edges); window.removeEventListener('resize', edges); };
  }, [path]);

  return (
    <nav className="nav" ref={ref}>
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={(path === i.href || path.startsWith(i.href + '/')) ? 'page' : undefined}>
          {i.label}{i.href === '/requests' && waiting > 0 && <span className="navbadge">{waiting}</span>}{i.href === '/registrations' && toCheck > 0 && <span className="navbadge">{toCheck}</span>}{i.href === '/client-requests' && clientNew > 0 && <span className="navbadge">{clientNew}</span>}
        </Link>
      ))}
    </nav>
  );
}
