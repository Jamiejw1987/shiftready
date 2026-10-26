import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendToTemp } from '@/lib/sms';
import { reminderText, reminderWa } from '@/lib/texts';
import { hhmm } from '@/lib/format';

/** Runs daily (see vercel.json). Texts everyone booked on tomorrow's shifts. */
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`)
    return new NextResponse('Forbidden', { status: 403 });

  const db = createAdminClient();
  const tomorrow = new Date(Date.now() + 864e5).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const { data: shifts } = await db.from('shifts').select('id,client,site,start_time,end_time,ppe').eq('shift_date', tomorrow).neq('status', 'cancelled');
  let sent = 0;
  for (const s of shifts ?? []) {
    const { data: offers } = await db.from('offers').select('id,temp_id,temps(first_name,mobile,status)').eq('shift_id', s.id).eq('status', 'accepted').is('reminded_at', null);
    for (const o of offers ?? []) {
      const t = o.temps as unknown as { first_name: string; mobile: string; status: string } | null;
      if (!t || t.status === 'out') continue;
      const info = { first: t.first_name, client: s.client, when: `${hhmm(s.start_time)}-${hhmm(s.end_time)}`, site: s.site, ppe: s.ppe ?? [] };
      await sendToTemp({ db, temp: { id: o.temp_id, mobile: t.mobile }, kind: 'reminder', offerId: o.id, body: reminderText(info), wa: { template: 'reminder', vars: reminderWa(info) } });
      await db.from('offers').update({ reminded_at: new Date().toISOString() }).eq('id', o.id);
      sent++;
    }
  }
  return NextResponse.json({ ok: true, date: tomorrow, reminders: sent });
}
