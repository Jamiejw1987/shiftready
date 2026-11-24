import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * A temp's name that opens their file. Use it anywhere a temp's name is shown to staff.
 * `newTab` for screens holding work you'd lose by leaving (search results, pasted payroll, a send in progress).
 */
export function TempLink({ id, children, newTab = false, className }: { id: string | null | undefined; children: ReactNode; newTab?: boolean; className?: string }) {
  if (!id) return <>{children}</>;
  return (
    <Link href={`/temps/${id}`} className={`templink${className ? ` ${className}` : ''}`}
      {...(newTab ? { target: '_blank', rel: 'noopener', title: 'Open their file in a new tab' } : { title: 'Open their file' })}>
      {children}
    </Link>
  );
}
