import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { PayrollClient } from './PayrollClient';
import { TimesheetConverter } from './TimesheetConverter';

export const dynamic = 'force-dynamic';

export default async function PayrollPage() {
  const { profile } = await requireStaff();
  if (profile.role !== 'admin' && !profile.payroll) redirect('/temps');
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <TimesheetConverter />
      <PayrollClient />
    </div>
  );
}
