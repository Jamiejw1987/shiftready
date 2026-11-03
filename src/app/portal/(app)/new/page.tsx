import { requireClient } from '@/lib/portalAuth';
import { JOB_TYPES } from '@/lib/format';
import { RequestForm } from './RequestForm';

export const dynamic = 'force-dynamic';

export default async function NewRequest({ searchParams }: { searchParams: { t?: string } }) {
  const { supabase, client, sites } = await requireClient();
  const { data: templates } = await supabase.from('client_templates').select('id,name,site_id,start_time,end_time,role,headcount,notes').eq('client_id', client.id).order('name');
  const mine = (templates ?? []).filter((t) => sites.some((s) => s.id === t.site_id))
    .map((t) => ({ id: t.id, name: t.name, siteId: t.site_id, start: t.start_time.slice(0, 5), end: t.end_time.slice(0, 5), role: t.role, headcount: t.headcount, notes: t.notes ?? '' }));
  return (
    <section className="panel">
      <h1>Request a shift</h1>
      <p className="lede">Tell us what you need. Our team is alerted straight away and books the people. You’ll see names here once they’re confirmed.</p>
      {sites.length
        ? <RequestForm sites={sites.map((s) => ({ id: s.id, name: s.name }))} templates={mine} roles={[...JOB_TYPES]} cutoff={client.cutoff_hours} startTemplate={searchParams.t ?? null} />
        : <p className="alert">You’re not set up for any sites yet. Please ask Staff Selection.</p>}
    </section>
  );
}
