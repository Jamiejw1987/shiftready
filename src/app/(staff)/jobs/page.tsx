import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { NewJob } from './JobForm';
import { JobFilters } from './JobFilters';

export const dynamic = 'force-dynamic';

type Job = {
  id: string; client_name: string; role: string; heads: number; pay_rate: number | null; shift_pattern: string | null;
  start_date: string | null; location: string | null; requirements: string | null; status: 'open' | 'filled' | 'closed'; created_at: string;
  job_candidates: { status: string }[] | null;
};
const day = (d: string | null) => (d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '');

export default async function JobsPage({ searchParams }: { searchParams: { show?: string; q?: string } }) {
  const { supabase, profile } = await requireStaff();
  const show = (['open', 'filled', 'closed', 'all'] as const).find((s) => s === searchParams.show) ?? 'open';
  const q = (searchParams.q ?? '').trim().toLowerCase();
  const [{ data, error }, { data: clients }] = await Promise.all([
    supabase.from('jobs').select('id,client_name,role,heads,pay_rate,shift_pattern,start_date,location,requirements,status,created_at,job_candidates(status)').order('start_date', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false }).limit(500),
    supabase.from('clients').select('id,name').eq('active', true).order('name'),
  ]);
  const all = (data ?? []) as Job[];
  const count = (s: string) => all.filter((j) => j.status === s).length;
  const jobs = all.filter((j) => (show === 'all' || j.status === show) && (!q || `${j.client_name} ${j.role} ${j.location ?? ''}`.toLowerCase().includes(q)));
  const toFill = all.filter((j) => j.status === 'open').reduce((n, j) => n + Math.max(0, j.heads - placed(j)), 0);

  return (
    <>
      <section className="panel">
        <h1>Jobs</h1>
        <p className="lede">Temp jobs that need filling. Add the job, put candidates forward, mark it filled when it’s done, and reopen it if someone drops out.</p>
        {error && <p className="alert">Run <b>supabase/2026-11-23-jobs.sql</b> in Supabase (SQL Editor) to switch this on.</p>}
        <NewJob clients={(clients ?? []).map((c) => ({ id: c.id, name: c.name }))} admin={profile.role === 'admin'} />
      </section>

      <section className="panel">
        <JobFilters show={show} q={searchParams.q ?? ''} counts={{ open: count('open'), filled: count('filled'), closed: count('closed'), all: all.length }} toFill={toFill} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14, marginTop: 14 }}>
          {jobs.map((j) => {
            const got = placed(j);
            const put = (j.job_candidates ?? []).filter((c) => c.status === 'proposed').length;
            const pill = j.status === 'filled' ? ['ok', 'Filled'] : j.status === 'closed' ? ['mute', 'Closed'] : got >= j.heads ? ['blue', 'Ready to mark filled'] : ['warn', `${j.heads - got} to fill`];
            return (
              <Link key={j.id} href={`/jobs/${j.id}`} className="jobcard">
                <span className="jobcard-top"><b>{j.client_name}</b><span className={`pill ${pill[0]}`}>{pill[1]}</span></span>
                <span className="jobcard-role">{j.heads} × {j.role}</span>
                <span className="jobbar" aria-label={`${got} of ${j.heads} placed`}><span style={{ width: `${Math.min(100, (100 * got) / j.heads)}%` }} /></span>
                <span className="note">{got} of {j.heads} placed{put ? ` · ${put} put forward` : ''}</span>
                <span className="jobcard-meta">
                  {j.pay_rate != null && <span>£{Number(j.pay_rate).toFixed(2)}/hr</span>}
                  {j.shift_pattern && <span>{j.shift_pattern}</span>}
                  {j.start_date && <span>Starts {day(j.start_date)}</span>}
                  {j.location && <span>{j.location}</span>}
                </span>
                {j.requirements && <span className="note">{j.requirements}</span>}
              </Link>
            );
          })}
        </div>
        {!jobs.length && <p className="note" style={{ marginTop: 12 }}>{q ? 'No jobs match that search.' : show === 'open' ? 'No open jobs. Add one above.' : 'Nothing here.'}</p>}
      </section>
    </>
  );
}

function placed(j: Job) {
  return (j.job_candidates ?? []).filter((c) => c.status === 'confirmed' || c.status === 'started').length;
}
