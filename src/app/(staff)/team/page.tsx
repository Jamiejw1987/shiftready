import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { fmtDateTime } from '@/lib/format';
import { TeamClient } from './TeamClient';

export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  const { supabase, profile } = await requireStaff({ admin: true });
  const [{ data: users }, { data: temps }, { data: shifts }, { data: log }] = await Promise.all([
    supabase.from('profiles').select('id,full_name,email,role,mobile,active').order('full_name'),
    supabase.from('temps').select('added_by'),
    supabase.from('shifts').select('sent_by'),
    supabase.from('audit_log').select('id,actor,action,detail,created_at').order('created_at', { ascending: false }).limit(300),
  ]);
  const count = (rows: { [k: string]: string | null }[] | null, key: string, id: string) => (rows ?? []).filter((r) => r[key] === id).length;
  const name = (id: string | null) => (id ? users?.find((u) => u.id === id)?.full_name ?? 'Former consultant' : 'Temp / system');

  return (
    <>
      <TeamClient
        meId={profile.id}
        members={(users ?? []).map((u) => ({ ...u, temps: count(temps, 'added_by', u.id), shifts: count(shifts, 'sent_by', u.id) }))}
      />
      <section className="panel">
        <h2>Registration documents</h2>
        <p className="lede">The Key Information Document, terms of engagement, privacy notice and 48-hour opt-out wording candidates sign when they register.</p>
        <Link className="btn ghost" href="/team/documents">Open documents</Link>
      </section>
      <section className="panel">
        <h2>Audit trail</h2>
        <p className="lede">Who did what, and when. Latest 300 actions. Only admins can see this.</p>
        <div className="tablewrap"><table className="cards">
          <thead><tr><th>Time</th><th>By</th><th>Action</th></tr></thead>
          <tbody>
            {(log ?? []).map((a) => (
              <tr key={a.id}>
                <td className="mono" data-l="Time">{fmtDateTime(a.created_at)}</td>
                <td data-l="By"><b>{name(a.actor)}</b></td>
                <td className="full">{a.detail}</td>
              </tr>
            ))}
            {!log?.length && <tr><td colSpan={3} className="note">Nothing recorded yet.</td></tr>}
          </tbody>
        </table></div>
      </section>
    </>
  );
}
