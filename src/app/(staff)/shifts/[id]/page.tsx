import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { shiftWhen, shiftHours } from '@/lib/format';
import { displayMobile } from '@/lib/phone';
import { BoardActions, AutoRefresh } from './BoardActions';
import { SendMore } from './SendMore';
import { AddToShift } from './AddToShift';
import { EditShift } from './EditShift';
import { ConfirmInterested } from './ConfirmInterested';
import { scoresFor, byScore } from '@/lib/clients';

export const dynamic = 'force-dynamic';

type OfferRow = {
  id: string; temp_id: string; status: string; decline_reason: string | null; awaiting_confirm: boolean; checkin_sent_at: string | null; checkin_reply: string | null; standby_at: string | null; distance_miles: number | null; responded_at: string | null;
  temps: { first_name: string; last_name: string; mobile: string; registered_at: string | null; bank_on_file: boolean } | null;
};

const LABEL: Record<string, [string, string]> = {
  sent: ['mute', 'No reply yet'], interested: ['blue', 'Interested'], accepted: ['ok', 'Accepted'], declined: ['mute', 'Declined'], standby: ['warn', 'Standby'], alerts: ['mute', 'Wants alerts'], noshow: ['bad', 'No-show'],
};

export default async function ShiftBoard({ params, searchParams }: { params: { id: string }; searchParams: { sent?: string; failed?: string; busy?: string; manual?: string } }) {
  const { supabase } = await requireStaff();
  const { data: s } = await supabase.from('shifts').select('*').eq('id', params.id).maybeSingle();
  if (!s) notFound();
  const { data: offersRaw } = await supabase
    .from('offers')
    .select('id,temp_id,status,decline_reason,awaiting_confirm,checkin_sent_at,checkin_reply,standby_at,distance_miles,responded_at,temps(first_name,last_name,mobile,registered_at,bank_on_file)')
    .eq('shift_id', s.id)
    .order('distance_miles');
  const offers = (offersRaw ?? []) as unknown as OfferRow[];
  const confirmed = offers.filter((o) => o.status === 'accepted').sort((a, b) => (a.responded_at ?? '').localeCompare(b.responded_at ?? ''));
  const standby = offers.filter((o) => o.status === 'standby').sort((a, b) => (a.standby_at ?? '').localeCompare(b.standby_at ?? ''));
  const declined = offers.filter((o) => o.status === 'declined');
  const name = (o: OfferRow) => (o.temps ? `${o.temps.first_name} ${o.temps.last_name}` : 'Deleted temp');
  const cancelled = s.status === 'cancelled';

  // Temps say they're interested, the office rings them and confirms (all shifts unless set to first come, first served).
  // Best-rated for this client first.
  const interestFlow = !!s.confirm_first;
  const fromClient = !!s.request_id;
  const scores = s.client_id ? await scoresFor(supabase, offers.map((o) => o.temp_id), s.client_id) : new Map();
  const interested = offers.filter((o) => o.status === 'interested' && !scores.get(o.temp_id)?.blocked).sort(byScore(scores));
  const { data: req } = s.request_id ? await supabase.from('client_requests').select('id,status,cancelled_by_client,headcount,notes').eq('id', s.request_id).maybeSingle() : { data: null };
  const { data: fb } = s.client_id ? await supabase.from('client_feedback').select('offer_id,attended,stars,return_to_site').in('offer_id', offers.map((o) => o.id)) : { data: [] as { offer_id: string; attended: boolean | null; stars: number | null; return_to_site: boolean | null }[] };
  const feedback = (id: string) => (fb ?? []).find((f) => f.offer_id === id);
  const starLine = (tempId: string) => {
    const x = scores.get(tempId);
    if (!x) return null;
    return <span className="scores">{x.client != null && <span className="pill blue">★ {x.client.toFixed(1)} here ({x.clientCount})</span>}{x.overall != null && <span className="pill mute">★ {x.overall.toFixed(1)} overall</span>}</span>;
  };

  return (
    <>
      <AutoRefresh seconds={15} />
      <section className="panel">
        <p className="note" style={{ margin: '0 0 6px' }}><Link href="/shifts">← All shifts</Link>{s.series_id && <> · <Link href={`/shifts/series/${s.series_id}`}>Back to the week view</Link></>}</p>
        <h1>{s.client}</h1>
        <p className="lede" style={{ marginBottom: 8 }}>
          {shiftWhen(s)} · {shiftHours(s).toFixed(1)} hrs · £{Number(s.pay_rate).toFixed(2)}/hr · {s.job_type} · {s.site}, {s.site_postcode} · within {Number(s.radius_miles)} mi
        </p>
        {interestFlow && !fromClient && (
          <p className="alert" style={{ marginBottom: 10, background: 'var(--blue-soft)', color: 'var(--blue-deep)' }}>
            Temps who say yes go under <b>Interested</b> and aren’t booked yet. Call them, then press <b>Book &amp; ask to confirm</b>: they get a text asking them to reply YES.
          </p>
        )}
        {fromClient && (
          <p className="alert" style={{ marginBottom: 10, background: 'var(--blue-soft)', color: 'var(--blue-deep)' }}>
            Client request{req ? <> (<Link href={`/client-requests/${req.id}`}>details</Link>)</> : ''}: temps can only say they’re interested. Nobody is booked, or shown to {s.client}, until you confirm them. {s.client} sees first names, surnames and whether they need an induction only.
          </p>
        )}
        {req?.status === 'cancelled' && req.cancelled_by_client && !cancelled && <p className="alert bad" style={{ marginBottom: 10 }}>{s.client} cancelled this request. Cancel the shift below so booked temps get a text.</p>}
        {searchParams.manual && <p className="okmsg">Shift created. Nobody has been texted: use Add someone by hand below to book people on, or Send to more temps if you change your mind.</p>}
        {searchParams.sent && <p className="okmsg">Offer texted to {searchParams.sent} temps{Number(searchParams.failed) ? `. ${searchParams.failed} texts failed` : ''}{Number(searchParams.busy) ? `. ${searchParams.busy} already booked at that time were skipped` : ''}. This page updates every 15 seconds.</p>}
        {cancelled
          ? <p className="err">This shift was cancelled. Booked temps were texted.</p>
          : <div className="board" style={{ marginTop: 12 }}>
              <div className="col"><h3>Confirmed <span className="count">{confirmed.length}/{s.heads}</span></h3>
                {Array.from({ length: s.heads }, (_, i) => confirmed[i]
                  ? <div key={i} className="slot filled"><span>{name(confirmed[i])}<br /><span className="note">{confirmed[i].temps && displayMobile(confirmed[i].temps!.mobile)}</span>{confirmed[i].temps?.registered_at && !confirmed[i].temps?.bank_on_file && <><br /><span className="pill warn">No bank details</span></>}{confirmed[i].awaiting_confirm && <><br /><span className="pill warn">Waiting for them to confirm</span></>}{fromClient && <><br />{starLine(confirmed[i].temp_id)}</>}{feedback(confirmed[i].id)?.attended === false && <><br /><span className="pill bad">Client: no-show</span></>}{feedback(confirmed[i].id)?.attended === true && <><br /><span className="pill ok">Client: attended{feedback(confirmed[i].id)?.stars ? ` · ★ ${feedback(confirmed[i].id)!.stars}` : ''}</span></>}{feedback(confirmed[i].id)?.return_to_site === false && <><br /><span className="pill bad">Client doesn’t want them back</span></>}{confirmed[i].checkin_reply === 'yes' ? <><br /><span className="pill ok">Confirmed coming</span></> : confirmed[i].checkin_reply === 'no' ? <><br /><span className="pill bad">Can’t make it</span></> : confirmed[i].checkin_sent_at ? <><br /><span className="pill warn">Check-in: no reply yet</span></> : null}</span><span className="btnrow"><BoardActions kind="remove" id={confirmed[i].id} /><BoardActions kind="noshow" id={confirmed[i].id} /></span></div>
                  : <div key={i} className="slot empty">Open slot</div>)}</div>
              {interestFlow
                ? <div className="col"><h3>Interested <span className="count">{interested.length}</span></h3>
                    {interested.length ? interested.map((o) => (
                      <div key={o.id} className="slot"><span>{name(o)}<br /><span className="note">{o.temps && displayMobile(o.temps.mobile)}{o.distance_miles != null ? ` · ${o.distance_miles} mi` : ''}</span><br />{starLine(o.temp_id) ?? <span className="note">No ratings yet</span>}</span>
                        {confirmed.length < s.heads && <ConfirmInterested shiftId={s.id} tempId={o.temp_id} first={o.temps?.first_name ?? ''} />}</div>
                    )) : <div className="slot empty">Nobody yet. Temps who reply YES appear here.</div>}</div>
                : <div className="col"><h3>Standby <span className="count">{standby.length}</span></h3>
                    {standby.length ? standby.map((o, i) => <div key={o.id} className="slot"><span>{i + 1}. {name(o)}</span></div>) : <div className="slot empty">Nobody yet</div>}</div>}
              <div className="col"><h3>Declined <span className="count">{declined.length}</span></h3>
                {declined.length ? declined.map((o) => <div key={o.id} className="slot"><span>{name(o)}</span>{o.decline_reason && <span className="pill mute">{o.decline_reason}</span>}</div>) : <div className="slot empty">None</div>}</div>
            </div>}
        {!cancelled && !s.series_id && confirmed.length < s.heads && s.shift_date >= new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' }) && <SendMore id={s.id} radius={Number(s.radius_miles)} />}
        {!cancelled && confirmed.length < s.heads && <AddToShift id={s.id} />}
        {!cancelled && <div className="bar"><span className="note">Duties: {s.duties.join('; ') || 'none listed'}{s.ppe.length ? ` · Must have: ${s.ppe.join(', ')}` : ''}</span><span className="btnrow"><EditShift id={s.id} heads={s.heads} pay={Number(s.pay_rate)} start={s.start_time} end={s.end_time} duties={s.duties ?? []} ppe={s.ppe ?? []} booked={confirmed.length} /><BoardActions kind="cancel" id={s.id} /></span></div>}
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
