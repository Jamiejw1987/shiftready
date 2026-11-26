'use server';
import { createAdminClient } from '@/lib/supabase/admin';
import { weekClosed } from '@/lib/poolWeek';

const UUID = /^[0-9a-f-]{36}$/i;

/** Saves the days a worker wants shifts next week, per site. Never touches days the office has changed. */
export async function saveWeek(token: string, picks: { poolId: string; days: number[] }[]) {
  if (!UUID.test(token)) return { ok: false, error: 'Link not valid.' };
  const db = createAdminClient();
  const { data: ask } = await db.from('pool_week_asks').select('id,temp_id,week_start,temps(first_name,last_name,status)').eq('token', token).maybeSingle();
  const t = ask?.temps as unknown as { first_name: string; last_name: string; status: string } | null;
  if (!ask || !t) return { ok: false, error: 'Link not valid.' };
  if (weekClosed(ask.week_start)) return { ok: false, error: 'This week has closed. Please call the office if you can do extra days.' };
  if (t.status !== 'active') return { ok: false, error: 'You can’t take shifts at the moment. Please contact the office.' };
  const { data: mine } = await db.from('pool_members').select('pool_id').eq('temp_id', ask.temp_id);
  const allowed = new Set((mine ?? []).map((m) => m.pool_id));
  const rows = picks.filter((p) => allowed.has(p.poolId)).map((p) => ({
    pool_id: p.poolId, temp_id: ask.temp_id, week_start: ask.week_start, updated_at: new Date().toISOString(),
    worker_days: [...new Set(p.days.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort(),
  }));
  if (rows.length) {
    const { error } = await db.from('pool_week').upsert(rows, { onConflict: 'pool_id,temp_id,week_start' });
    if (error) return { ok: false, error: 'Couldn’t save. Please try again.' };
  }
  await db.from('pool_week_asks').update({ replied_at: new Date().toISOString() }).eq('id', ask.id);
  const n = rows.reduce((a, r) => a + r.worker_days.length, 0);
  await db.from('audit_log').insert({ actor: null, action: 'pool.availability_reply', detail: `${t.first_name} ${t.last_name} said they can do ${n} day${n === 1 ? '' : 's'} (${ask.week_start} week)` });
  return { ok: true, days: n };
}
