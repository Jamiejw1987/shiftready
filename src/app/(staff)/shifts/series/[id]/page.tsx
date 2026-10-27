import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { displayMobile } from '@/lib/phone';
import { shiftHours } from '@/lib/format';
import { seriesWhen, dayShort } from '@/lib/series';
import { AutoRefresh } from '../../[id]/BoardActions';
import { WeekGrid, SeriesSendMore } from './WeekGrid';

export const dynamic = 'force-dynamic';

type Offer = { id: string; shift_id: string; temp_id: string; status: string; available: boolean | null; distance_miles: number | null; temps: { first_name: string; last_name: string; mobile: string } | null };

export default async function SeriesBoard({ params, searchParams }: { params: { id: string }; searchParams: { sent?: string; failed?: string } }) {
  const { supabase } = await requireStaff();
  const { data: days } = await supabase.from('shifts').select('*').eq('series_id', params.id).order('shift_date');
  if (!days?.length) notFound();
  const { data: raw } = await supabase.from('offers').select('id,shift_id,temp_id,status,available,distance_miles,temps(first_name,last_name,mobile)').in('shift_id', days.map((d) => d.id));
  const offers = (raw ?? []) as unknown as Offer[];
  const s0 = days[0];
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });

  // One row per temp who's said they're free on at least one day, or is booked.
  const people = new Map<string, { id: string; name: string; mobile: string; miles: number | null; cells: Record<string, { offerId: string; status: string; available: boolean | null }> }>();
  let waiting = 0;
  const askedTemps = new Set<string>(), repliedTemps = new Set<string>();
  for (const o of offers) {
    askedTemps.add(o.temp_id);
    if (o.available !== null || o.status === 'accepted') repliedTemps.add(o.temp_id);
    if (!(o.available || o.status === 'accepted')) continue;
    const p = people.get(o.temp_id) ?? { id: o.temp_id, name: o.temps ? `${o.temps.first_name} ${o.temps.last_name}` : 'Deleted temp', mobile: o.temps ? displayMobile(o.temps.mobile) : '', miles: o.distance_miles, cells: {} };
    p.cells[o.shift_id] = { offerId: o.id, status: o.status, available: o.available };
    people.set(o.temp_id, p);
  }
  waiting = askedTemps.size - repliedTemps.size;
  const rows = [...people.values()].sort((a, b) => Object.keys(b.cells).length - Object.keys(a.cells).length || (a.miles ?? 99) - (b.miles ?? 99));
  const cols = days.map((d) => ({
    id: d.id, label: dayShort(d.shift_date), heads: d.heads, cancelled: d.status === 'cancelled', past: d.shift_date < today,
    booked: offers.filter((o) => o.shift_id === d.id && o.status === 'accepted').length,
  }));
  const open = cols.some((c) => !c.cancelled && !c.past && c.booked < c.heads);

  return (
    <>
      <AutoRefresh seconds={20} />
      <section className="panel">
        <p className="note" style={{ margin: '0 0 6px' }}><Link href="/shifts">← All shifts</Link></p>
        <h1>{s0.client} <span className="pill blue" style={{ verticalAlign: 'middle' }}>{days.length} days</span></h1>
        <p className="lede" style={{ marginBottom: 8 }}>
          {seriesWhen(days)} · {shiftHours(s0).toFixed(1)} hrs · £{Number(s0.pay_rate).toFixed(2)}/hr · {s0.job_type} · {s0.site}, {s0.site_postcode} · {s0.heads} a day
        </p>
        {searchParams.sent && <p className="okmsg">Offer sent to {searchParams.sent} temps (one text each for all the days){Number(searchParams.failed) ? `. ${searchParams.failed} failed` : ''}. Their days appear below as they reply.</p>}
        <p className="note">{repliedTemps.size} of {askedTemps.size} temps have replied{waiting ? `, ${waiting} still to reply` : ''}. Tick the days you want each person on, then book them: each person gets one text listing their days.</p>
        <WeekGrid seriesId={params.id} cols={cols} rows={rows} />
        {open && <SeriesSendMore seriesId={params.id} radius={Number(s0.radius_miles)} />}
      </section>
      <section className="panel">
        <h2>Each day</h2>
        <p className="lede">Open a day to take people off, mark no-shows, add someone by hand or edit it.</p>
        <div className="btnrow">
          {days.map((d, i) => (
            <Link key={d.id} className="btn ghost small" href={`/shifts/${d.id}`}>{cols[i].label} · {cols[i].booked}/{d.heads}{d.status === 'cancelled' ? ' (cancelled)' : ''}</Link>
          ))}
        </div>
      </section>
    </>
  );
}
