import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { Logo } from '@/components/Logo';
import { shiftWhen, shiftHours, fmtDate, hhmm } from '@/lib/format';
import { OfferPanel } from './OfferPanel';
import { SeriesPanel } from './SeriesPanel';
import { seriesWhen } from '@/lib/series';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Shift offer | ShiftReady' };
const UUID = /^[0-9a-f-]{36}$/i;

export default async function OfferPage({ params }: { params: { token: string } }) {
  if (!UUID.test(params.token)) notFound();
  const db = createAdminClient();
  const { data: o } = await db
    .from('offers')
    .select('id,temp_id,status,decline_reason,distance_miles,standby_at,shift_id,temps(first_name,status,optin_token,reg_token,registered_at,bank_on_file),shifts(*)')
    .eq('token', params.token)
    .maybeSingle();
  if (!o) notFound();
  const t = o.temps as unknown as { first_name: string; status: string; optin_token: string; reg_token: string; registered_at: string | null; bank_on_file: boolean };
  const s = o.shifts as unknown as {
    id: string; client: string; site: string; site_postcode: string; shift_date: string; start_time: string; end_time: string;
    job_type: string; duties: string[]; pay_rate: number; heads: number; ppe: string[]; status: string;
  };
  const series = (o.shifts as unknown as { series_id: string | null }).series_id;
  if (series) {
    const { data: days } = await db.from('shifts').select('id,shift_date,start_time,end_time,status,heads').eq('series_id', series).order('shift_date');
    const { data: mine } = await db.from('offers').select('id,shift_id,status,available,decline_reason').eq('temp_id', (o as unknown as { temp_id?: string }).temp_id ?? '').in('shift_id', (days ?? []).map((d) => d.id));
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
    const rows = (days ?? []).flatMap((d) => {
      const m = (mine ?? []).find((x) => x.shift_id === d.id);
      if (!m) return [];
      return [{ offerId: m.id, date: d.shift_date, booked: m.status === 'accepted', available: m.available as boolean | null,
        closed: d.status === 'cancelled' || d.shift_date < today || (m.status === 'declined' && m.decline_reason === 'Removed by office') || m.status === 'noshow' }];
    });
    return (
      <main className="tpage">
        <div className="tbar"><Logo small /></div>
        <div className="tbody">
          <SeriesPanel token={params.token} firstName={t.first_name} tempActive={t.status === 'active'}
            bankUrl={t.registered_at && !t.bank_on_file ? `/b/${t.reg_token}` : null}
            shift={{ client: s.client, site: `${s.site}, ${s.site_postcode}`, when: seriesWhen((days ?? []).filter((d) => rows.some((r) => r.date === d.shift_date))),
              hours: shiftHours(s), pay: Number(s.pay_rate), role: s.job_type, duties: s.duties ?? [], ppe: s.ppe ?? [], time: `${hhmm(s.start_time)}-${hhmm(s.end_time)}` }}
            days={rows} />
        </div>
      </main>
    );
  }
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
          bankUrl={t.registered_at && !t.bank_on_file ? `/b/${t.reg_token}` : null}
          offerStatus={o.status === 'declined' && o.decline_reason === 'Removed by office' ? 'removed' : o.status}
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
