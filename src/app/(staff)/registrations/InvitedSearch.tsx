'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/** Search box for "Links sent, not finished yet". Updates ?q= after 300ms of no typing; the page filters in the database. */
export function InvitedSearch({ initial }: { initial: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(initial);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (value.trim()) next.set('q', value.trim()); else next.delete('q');
      next.delete('p'); // back to page 1 on a new search
      const qs = next.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ''}#not-finished`, { scroll: false });
    }, 300);
    return () => clearTimeout(t);
  }, [value]);

  return (
    <input
      type="search"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder="Search name, mobile or postcode"
      aria-label="Search links sent, not finished yet"
      style={{ width: '100%', margin: '4px 0 10px' }}
    />
  );
}
