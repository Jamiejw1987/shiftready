import { requireStaff } from '@/lib/auth';
import { BankClient, type BankRow } from './BankClient';

export const dynamic = 'force-dynamic';

export default async function BankPage() {
  const { supabase } = await requireStaff({ admin: true });
  const { data } = await supabase
    .from('temps')
    .select('id,first_name,last_name,mobile,status,registered_at,bank_on_file,temp_profiles(bank_last4,bank_added_at)')
    .not('registered_at', 'is', null)
    .neq('status', 'out')
    .order('last_name');

  const rows: BankRow[] = (data ?? []).map((t) => {
    const raw = t.temp_profiles as unknown;
    const p = (Array.isArray(raw) ? raw[0] : raw) as { bank_last4: string | null; bank_added_at: string | null } | null;
    return {
      id: t.id, first: t.first_name, last: t.last_name, mobile: t.mobile, status: t.status,
      onFile: !!t.bank_on_file && !!p?.bank_last4, last4: p?.bank_last4 ?? null, addedAt: p?.bank_added_at ?? null,
    };
  });

  return <BankClient rows={rows} />;
}
