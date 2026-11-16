import { requireStaff } from '@/lib/auth';
import { loadAssignments } from '@/lib/ongoing';
import { ongoingCsv } from '@/lib/ongoingCsv';

export const dynamic = 'force-dynamic';

/** Every client's ongoing workers (current and finished) as one CSV. */
export async function GET() {
  const { supabase } = await requireStaff({ admin: true });
  const { list } = await loadAssignments(supabase, {});
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  list.sort((a, b) => a.client_name.localeCompare(b.client_name) || a.temp_name.localeCompare(b.temp_name));
  return ongoingCsv(list, today, `ongoing-workers-${today}.csv`);
}
