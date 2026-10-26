import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { Logo } from '@/components/Logo';
import { shiftWhen, shiftHours, fmtDate, hhmm } from '@/lib/format';
import { OfferPanel } from './OfferPanel';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Shift offer | ShiftReady' };
const UUID = /^[0-9a-f-]{36}$/i;

export default async function OfferPage({ params }: { params: { token: string } }) {
  if (!UUID.test(params.token)) notFound();
  const db = createAdminClient();
  const { data: o } = await db
    .from('offers')
    .select('id,status,distance_miles,standby_at,shift_id,temps(first_name,status,optin_token),shifts(*)')
    .eq('token', params.token)
    .maybeSingle();
  if (!o) notFound();
  const t = o.temps as unknown as { first_name: string; status: string; optin_token: string };
  const s = o.shifts as unknown as {
    id: string; client: string; site: string; site_postcode: string; shift_date: string; start_time: string; end_time: string;
    job_type: string; duties: string[]; pay_rate: number; heads: number; ppe: string[]; status: string;
  };
  const { count: filled } = await db.from('offers').select('id', { count: 'exact', head: true }).eq('shift_id', s.id).eq('status', 'accepted');
  let standbyPos = 0;
  if (o.status === 'standby') {
    const { count } = await db.from('offers').select('id', { count: 'exact', head: true }).eq('shift_id', s.id).eq('status', 'standby').lte('standby_at', o.standby_at);
    standbyPos = count ?? 0;
  }
  const past = s.shift_date < new Date().toISOString().slice(0, 10);

  return (
    <main className="tpage">
      <div className="tbar"><Logo small /></div>
      <div className="tbody">
        <OfferPanel
          token={params.token}
          firstName={t.first_name}
          tempActive={t.status === 'active'}
          offerStatus={o.status}
          standbyPos={standbyPos}
          shiftState={s.status === 'cancelled' ? 'cancelled' : past ? 'past' : (filled ?? 0) >= s.heads ? 'full' : 'open'}
          placesLeft={Math.max(0, s.heads - (filled ?? 0))}
          shift={{
            client: s.client, site: `${s.site}, ${s.site_postcode}`, when: `${fmtDate(s.shift_date)}, ${hhmm(s.start_time)}-${hhmm(s.end_time)}`,
            whenShort: shiftWhen(s), hours: shiftHours(s), pay: Number(s.pay_rate), role: s.job_type, duties: s.duties, ppe: s.ppe,
            miles: o.distance_miles,
          }}
        />
      </div>
    </main>
  );
}
