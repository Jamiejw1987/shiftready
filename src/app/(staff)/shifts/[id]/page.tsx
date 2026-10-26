import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { shiftWhen, shiftHours } from '@/lib/format';
import { displayMobile } from '@/lib/phone';
import { BoardActions, AutoRefresh } from './BoardActions';

export const dynamic = 'force-dynamic';

type OfferRow = {
  id: string; status: string; decline_reason: string | null; standby_at: string | null; distance_miles: number | null; responded_at: string | null;
  temps: { first_name: string; last_name: string; mobile: string } | null;
};

const LABEL: Record<string, [string, string]> = {
  sent: ['mute', 'No reply yet'], accepted: ['ok', 'Accepted'], declined: ['mute', 'Declined'], standby: ['warn', 'Standby'], alerts: ['mute', 'Wants alerts'], noshow: ['bad', 'No-show'],
};

export default async function ShiftBoard({ params, searchParams }: { params: { id: string }; searchParams: { sent?: string; failed?: string } }) {
  const { supabase } = await requireStaff();
  const { data: s } = await supabase.from('shifts').select('*').eq('id', params.id).maybeSingle();
  if (!s) notFound();
  const { data: offersRaw } = await supabase
    .from('offers')
    .select('id,status,decline_reason,standby_at,distance_miles,responded_at,temps(first_name,last_name,mobile)')
    .eq('shift_id', s.id)
    .order('distance_miles');
  const offers = (offersRaw ?? []) as unknown as OfferRow[];
  const confirmed = offers.filter((o) => o.status === 'accepted').sort((a, b) => (a.responded_at ?? '').localeCompare(b.responded_at ?? ''));
  const standby = offers.filter((o) => o.status === 'standby').sort((a, b) => (a.standby_at ?? '').localeCompare(b.standby_at ?? ''));
  const declined = offers.filter((o) => o.status === 'declined');
  const name = (o: OfferRow) => (o.temps ? `${o.temps.first_name} ${o.temps.last_name}` : 'Deleted temp');
  const cancelled = s.status === 'cancelled';

  return (
    <>
      <AutoRefresh seconds={15} />
      <section className="panel">
        <p className="note" style={{ margin: '0 0 6px' }}><Link href="/shifts">← All shifts</Link></p>
        <h1>{s.client}</h1>
        <p className="lede" style={{ marginBottom: 8 }}>
          {shiftWhen(s)} · {shiftHours(s).toFixed(1)} hrs · £{Number(s.pay_rate).toFixed(2)}/hr · {s.job_type} · {s.site}, {s.site_postcode} · within {Number(s.radius_miles)} mi
        </p>
        {searchParams.sent && <p className="okmsg">Offer texted to {searchParams.sent} temps{Number(searchParams.failed) ? `. ${searchParams.failed} texts failed` : ''}. This page updates every 15 seconds.</p>}
        {cancelled
          ? <p className="err">This shift was cancelled. Booked temps were texted.</p>
          : <div className="board" style={{ marginTop: 12 }}>
              <div className="col"><h3>Confirmed <span className="count">{confirmed.length}/{s.heads}</span></h3>
                {Array.from({ length: s.heads }, (_, i) => confirmed[i]
                  ? <div key={i} className="slot filled"><span>{name(confirmed[i])}<br /><span className="note">{confirmed[i].temps && displayMobile(confirmed[i].temps!.mobile)}</span></span><BoardActions kind="noshow" id={confirmed[i].id} /></div>
                  : <div key={i} className="slot empty">Open slot</div>)}</div>
              <div className="col"><h3>Standby <span className="count">{standby.length}</span></h3>
                {standby.length ? standby.map((o, i) => <div key={o.id} className="slot"><span>{i + 1}. {name(o)}</span></div>) : <div className="slot empty">Nobody yet</div>}</div>
              <div className="col"><h3>Declined <span className="count">{declined.length}</span></h3>
                {declined.length ? declined.map((o) => <div key={o.id} className="slot"><span>{name(o)}</span>{o.decline_reason && <span className="pill mute">{o.decline_reason}</span>}</div>) : <div className="slot empty">None</div>}</div>
            </div>}
        {!cancelled && <div className="bar"><span className="note">Duties: {s.duties.join('; ') || 'none listed'}{s.ppe.length ? ` · Must have: ${s.ppe.join(', ')}` : ''}</span><BoardActions kind="cancel" id={s.id} /></div>}
      </section>

      <section className="panel">
        <h2>Who it went to</h2>
        <div className="tablewrap"><table className="cards">
          <thead><tr><th>Temp</th><th>Mobile</th><th>Miles</th><th>Response</th></tr></thead>
          <tbody>
            {offers.map((o) => (
              <tr key={o.id}>
                <td><b>{name(o)}</b></td>
                <td className="num" data-l="Mobile">{o.temps ? displayMobile(o.temps.mobile) : ''}</td>
                <td className="num" data-l="Miles">{o.distance_miles ?? '-'}</td>
                <td><span className={`pill ${LABEL[o.status][0]}`}>{LABEL[o.status][1]}</span></td>
              </tr>
            ))}
            {!offers.length && <tr><td colSpan={4} className="note">Nobody matched this shift. Try a bigger radius, or check temps are active and cleared for {s.job_type}.</td></tr>}
          </tbody>
        </table></div>
      </section>
    </>
  );
}
