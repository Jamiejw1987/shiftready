import { requireStaff } from '@/lib/auth';
import { TempsClient, type TempRow } from './TempsClient';

export const dynamic = 'force-dynamic';

export default async function TempsPage() {
  const { supabase, profile } = await requireStaff();
  const [{ data: temps }, { data: users }] = await Promise.all([
    supabase.from('temps').select('id,first_name,last_name,mobile,postcode,lat,lng,job_types,status,added_by,created_at').order('created_at', { ascending: false }),
    supabase.from('profiles').select('id,full_name').order('full_name'),
  ]);
  return (
    <TempsClient
      temps={(temps ?? []) as TempRow[]}
      users={users ?? []}
      me={{ id: profile.id, name: profile.full_name, admin: profile.role === 'admin' }}
    />
  );
}
