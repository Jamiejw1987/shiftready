import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendSms, sendToTemp } from '@/lib/sms';
import { reminderText, reminderWa } from '@/lib/texts';
import { hhmm } from '@/lib/format';

/** Runs daily (see vercel.json). Texts everyone booked on tomorrow's shifts. */
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`)
    return new NextResponse('Forbidden', { status: 403 });

  const db = createAdminClient();
  const tomorrow = new Date(Date.now() + 864e5).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const { data: shifts } = await db.from('shifts').select('id,client,site,start_time,end_time,ppe,series_id,shift_date').eq('shift_date', tomorrow).neq('status', 'cancelled');
  let sent = 0;
  for (const s of shifts ?? []) {
    const { data: offers } = await db.from('offers').select('id,temp_id,temps(first_name,mobile,status)').eq('shift_id', s.id).eq('status', 'accepted').is('reminded_at', null);
    for (const o of offers ?? []) {
      const t = o.temps as unknown as { first_name: string; mobile: string; status: string } | null;
      if (!t || t.status === 'out') continue;
      // Weekly shifts: only the day-before reminder for their first booked day (the 2-hour check-in still goes every day).
      if (s.series_id) {
        const { data: earlier } = await db.from('offers').select('id, shifts!inner(series_id,shift_date)').eq('temp_id', o.temp_id).eq('status', 'accepted')
          .eq('shifts.series_id', s.series_id).lt('shifts.shift_date', s.shift_date).limit(1);
        if (earlier?.length) { await db.from('offers').update({ reminded_at: new Date().toISOString() }).eq('id', o.id); continue; }
      }
      const info = { first: t.first_name, client: s.client, when: `${hhmm(s.start_time)}-${hhmm(s.end_time)}`, site: s.site, ppe: s.ppe ?? [] };
      await sendToTemp({ db, temp: { id: o.temp_id, mobile: t.mobile }, kind: 'reminder', offerId: o.id, body: reminderText(info), wa: { template: 'reminder', vars: reminderWa(info) } });
      await db.from('offers').update({ reminded_at: new Date().toISOString() }).eq('id', o.id);
      sent++;
    }
  }

  // Right to work: anyone whose time-limited permission has ended goes on hold, so they can't be offered or accept shifts.
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const { data: expired } = await db.from('temps').select('id,first_name,last_name,added_by').lt('rtw_expires', today).eq('status', 'active');
  for (const t of expired ?? []) {
    await db.from('temps').update({ status: 'hold' }).eq('id', t.id);
    await db.from('audit_log').insert({ actor: null, action: 'temp.rtw_expired', detail: `${t.first_name} ${t.last_name} put on hold: right to work expired` });
    if (t.added_by) {
      const { data: c } = await db.from('profiles').select('mobile').eq('id', t.added_by).maybeSingle();
      if (c?.mobile) await sendSms({ db, to: c.mobile, kind: 'system', body: `ShiftReady: ${t.first_name} ${t.last_name}'s right to work has expired, so they're on hold. Ask them for a new share code and record a new check.` });
    }
  }
  return NextResponse.json({ ok: true, date: tomorrow, reminders: sent, rtwExpired: expired?.length ?? 0 });
}
