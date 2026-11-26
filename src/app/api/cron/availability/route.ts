import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { londonNow, nextWeek, askForWeek, remindForWeek } from '@/lib/poolWeek';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Called every 15 minutes by the database (pg_cron). Weekly pool availability:
 * - Friday from 8am (until Sunday 6pm): texts everyone in a pool who hasn't been asked about next week.
 * - Saturday from 12pm: one reminder to anyone who hasn't replied.
 * Answers close Sunday night (the link goes read-only on Monday).
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

  const now = londonNow();
  const week = nextWeek(now.date);
  const asking = (now.dow === 5 && now.hour >= 8) || now.dow === 6 || (now.dow === 7 && now.hour < 18);
  const reminding = (now.dow === 6 && now.hour >= 12) || (now.dow === 7 && now.hour < 12);
  const asked = asking ? await askForWeek(db, week) : null;
  const reminded = reminding ? await remindForWeek(db, week) : null;
  if (asked?.sent || reminded?.sent) {
    await db.from('audit_log').insert({ actor: null, action: 'pool.availability_texts', detail: `Weekly availability (${week}): ${asked?.sent ?? 0} asked, ${reminded?.sent ?? 0} reminded` });
  }
  return NextResponse.json({ ok: true, week, asked, reminded });
}
