import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { NewClient } from './ClientForms';

export const dynamic = 'force-dynamic';

export default async function ClientsPage() {
  const { supabase } = await requireStaff();
  const [{ data: clients }, { data: users }, { data: sites }, { data: open }] = await Promise.all([
    supabase.from('clients').select('id,name,active,is_test,cutoff_hours').order('name'),
    supabase.from('client_users').select('client_id,status'),
    supabase.from('client_sites').select('client_id,active'),
    supabase.from('client_requests').select('client_id').eq('status', 'submitted'),
  ]);
  const n = (rows: { client_id: string }[] | null, id: string) => (rows ?? []).filter((r) => r.client_id === id).length;
  return (
    <>
      <section className="panel">
        <h1>Clients</h1>
        <p className="lede">Clients with a portal login can request shifts, see who’s booked and mark attendance. Open a client to add sites and invite their managers.</p>
        <div className="tablewrap"><table className="cards">
          <thead><tr><th>Client</th><th className="num">Sites</th><th className="num">Portal users</th><th className="num">New requests</th><th>Status</th></tr></thead>
          <tbody>
            {(clients ?? []).map((c) => (
              <tr key={c.id} style={c.active ? undefined : { opacity: 0.6 }}>
                <td><Link href={`/clients/${c.id}`}><b>{c.name}</b></Link>{c.is_test && <> <span className="pill blue">Test</span></>}</td>
                <td className="num" data-l="Sites">{n((sites ?? []).filter((s) => s.active), c.id)}</td>
                <td className="num" data-l="Portal users">{n((users ?? []).filter((u) => u.status !== 'removed'), c.id)}</td>
                <td className="num" data-l="New requests">{n(open, c.id) || '-'}</td>
                <td><span className={`pill ${c.active ? 'ok' : 'mute'}`}>{c.active ? 'Active' : 'Off'}</span></td>
              </tr>
            ))}
            {!clients?.length && <tr><td colSpan={5} className="note">No clients yet. Add your first one below.</td></tr>}
          </tbody>
        </table></div>
      </section>
      <NewClient />
    </>
  );
}
