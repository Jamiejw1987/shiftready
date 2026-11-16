import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { importReady } from './actions';
import { ImportClient } from './ImportClient';

export const dynamic = 'force-dynamic';

export default async function ImportWorkersPage() {
  const { supabase } = await requireStaff({ admin: true });
  const ready = await importReady();
  const { data: clients } = await supabase.from('clients').select('id,name').eq('is_test', false).order('name');
  // Mobiles already on ShiftReady, so the preview can show who's already here. Paged: Supabase returns 1,000 rows at a time.
  const mobiles: string[] = [];
  for (let from = 0; from < 100000; from += 1000) {
    const { data } = await supabase.from('temps').select('mobile').order('id').range(from, from + 999);
    mobiles.push(...(data ?? []).map((t) => t.mobile as string));
    if (!data || data.length < 1000) break;
  }
  return (
    <>
      <section className="panel">
        <p className="note" style={{ margin: '0 0 6px' }}><Link href="/temps">← Temps</Link></p>
        <h1>Import workers (no messages)</h1>
        <p className="lede">Bring workers over from another temp system (e.g. a KISREC export) as a CSV. <b>Nothing is sent to anyone</b>: no welcome text, no registration link, no shift offers. Everyone imported has their messages switched off, and you can mark them as ongoing at a client so they show in reports.</p>
        {!ready.ok && <p className="alert">{ready.error}</p>}
        {ready.ok && !ready.encryption && <p className="alert">FIELD_ENCRYPTION_KEY isn’t set, so NI numbers and bank details can’t be imported. Everything else can.</p>}
      </section>
      {ready.ok && <ImportClient clients={clients ?? []} existingMobiles={mobiles} encryption={ready.encryption} />}
    </>
  );
}
