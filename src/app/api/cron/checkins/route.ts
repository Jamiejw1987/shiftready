import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendSms, sendToTemp } from '@/lib/sms';
import { hhmm } from '@/lib/format';
import { londonToDate } from '@/lib/when';

export const dynamic = 'force-dynamic';

const LEAD_MIN = 120;      // send the check-in this long before the shift starts
const CHASE_AFTER_MIN = 30; // tell the consultant if there's no reply after this long

/**
 * Called every 10 minutes by the database (pg_cron). Texts everyone booked on a shift starting within 2 hours to
 * confirm they're still coming, and tells the consultant about anyone who hasn't replied after 30 minutes.
 */
export async function GET(req: NextRequest) {
  const db = createAdminClient();
  const bearer = process.env.CRON_SECRET && req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
  const key = req.headers.get('x-cron-key');
  let allowed = !!bearer;
  if (!allowed && key) {
    const { data } = await db.from('app_secrets').select('value').eq('name', 'cron_key').maybeSingle();
    allowed = !!data?.value && data.value === key;
  }
  if (!allowed) return new NextResponse('Forbidden', { status: 403 });

  const now = Date.now();
  const day = (offset: number) => new Date(now + offset * 864e5).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const { data: rows } = await db.from('offers')
    .select('id,temp_id,checkin_sent_at,checkin_reply,checkin_alerted_at,temps(first_name,last_name,mobile,status),shifts!inner(id,client,site,shift_date,start_time,end_time,status,sent_by)')
    .eq('status', 'accepted').gte('shifts.shift_date', day(-1)).lte('shifts.shift_date', day(1)).neq('shifts.status', 'cancelled');

  let sent = 0, chased = 0;
  for (const o of rows ?? []) {
    const s = o.shifts as unknown as { id: string; client: string; site: string; shift_date: string; start_time: string; end_time: string; sent_by: string | null };
    const t = o.temps as unknown as { first_name: string; last_name: string; mobile: string; status: string } | null;
    if (!t) continue;
    const mins = (londonToDate(s.shift_date, s.start_time).getTime() - now) / 60000;
    if (mins <= 0) continue; // already started

    if (!o.checkin_sent_at && mins <= LEAD_MIN && t.status !== 'out') {
      const when = s.shift_date === day(0) ? 'today' : 'tomorrow';
      await sendToTemp({ db, temp: { id: o.temp_id, mobile: t.mobile }, kind: 'checkin', offerId: o.id,
        body: `Hi ${t.first_name}, your ${s.client} shift starts at ${hhmm(s.start_time)} ${when}. Are you still coming? Reply YES to confirm or NO if you can't make it. - Staff Selection` });
      await db.from('offers').update({ checkin_sent_at: new Date().toISOString() }).eq('id', o.id);
      sent++;
      continue;
    }

    if (o.checkin_sent_at && !o.checkin_reply && !o.checkin_alerted_at && now - Date.parse(o.checkin_sent_at) >= CHASE_AFTER_MIN * 60000) {
      await db.from('offers').update({ checkin_alerted_at: new Date().toISOString() }).eq('id', o.id);
      await db.from('audit_log').insert({ actor: null, action: 'checkin.no_reply', detail: `${t.first_name} ${t.last_name} hasn't confirmed for ${s.client} at ${hhmm(s.start_time)}` });
      if (s.sent_by) {
        const { data: c } = await db.from('profiles').select('mobile').eq('id', s.sent_by).maybeSingle();
        if (c?.mobile) await sendSms({ db, to: c.mobile, kind: 'system', body: `ShiftReady: ${t.first_name} ${t.last_name} hasn't confirmed they're coming to ${s.client} at ${hhmm(s.start_time)}. Worth a call.` });
      }
      chased++;
    }
  }
  return NextResponse.json({ ok: true, sent, chased });
}
