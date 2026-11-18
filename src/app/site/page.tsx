import { Logo } from '@/components/Logo';
import { requireSupervisor, siteDays } from '@/lib/siteAuth';
import { bookedForSupervisor } from '@/lib/siteData';
import { SiteList } from './SiteClient';
import { siteSignOut } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Day one | ShiftReady', robots: { index: false } };

export default async function SitePage() {
  const sup = await requireSupervisor();
  const rows = await bookedForSupervisor(sup);
  const { today } = siteDays();
  const nice = new Date(today + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <main className="tpage"><div className="tbar"><Logo small /></div><div className="tbody">
      <div className="ind-head">
        <span className="note">Signed in as {sup.full_name} · <form action={siteSignOut} style={{ display: 'inline' }}><button className="linkbtn" style={{ background: 'none', border: 0, padding: 0, color: 'var(--blue-deep)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}>sign out</button></form></span>
        <span className="doc">Day one sign-off</span>
        <span className="note">{nice}. Everyone booked today, then everyone who’s been sent the induction and still needs their day one.</span>
      </div>
      <section className="card"><div className="in">
        <b>How it works</b>
        <ol style={{ margin: 0, paddingLeft: 20 }}>
          <li>Find them below (search by name) and tap their name.</li>
          <li><b>Manual handling assessment:</b> watch them, tap Yes or No for each check, then you both sign.</li>
          <li><b>Day-one sign-off:</b> show them the fire exits and assembly point, site rules, toilets, washing facilities and canteen. They initial each point on screen, then you both sign.</li>
          <li>Both save straight to their file. Nothing to print or hand in.</li>
        </ol>
      </div></section>
      <SiteList rows={rows} trainer={sup.full_name} />
    </div></main>
  );
}
