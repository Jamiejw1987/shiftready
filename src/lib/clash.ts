import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { shiftHours } from './format';

type S = { id?: string; shift_date: string; start_time: string; end_time: string };

/** A shift as [start, end) in minutes since the epoch, handling shifts that run past midnight. */
function span(s: S): [number, number] {
  const [h, m] = s.start_time.split(':').map(Number);
  const start = Date.parse(s.shift_date + 'T00:00:00Z') / 60000 + h * 60 + m;
  return [start, start + shiftHours(s) * 60];
}
export const overlaps = (a: S, b: S) => { const [a1, a2] = span(a), [b1, b2] = span(b); return a1 < b2 && b1 < a2; };

const around = (date: string) => {
  const d = Date.parse(date + 'T12:00:00Z');
  return [new Date(d - 864e5).toISOString().slice(0, 10), new Date(d + 864e5).toISOString().slice(0, 10)];
};

/** Accepted bookings for these temps on shifts near this date (not cancelled), grouped by temp. */
export async function bookingsNear(db: SupabaseClient, tempIds: string[], date: string) {
  const [from, to] = around(date);
  const out = new Map<string, (S & { id: string; client: string })[]>();
  for (let i = 0; i < tempIds.length; i += 300) {
    const { data } = await db.from('offers')
      .select('temp_id, shifts!inner(id,client,shift_date,start_time,end_time,status)')
      .in('temp_id', tempIds.slice(i, i + 300)).eq('status', 'accepted')
      .gte('shifts.shift_date', from).lte('shifts.shift_date', to).neq('shifts.status', 'cancelled');
    for (const r of data ?? []) {
      const s = r.shifts as unknown as S & { id: string; client: string };
      out.set(r.temp_id, [...(out.get(r.temp_id) ?? []), s]);
    }
  }
  return out;
}

/** The shift this temp is already booked on that overlaps `shift`, if any. */
export async function findClash(db: SupabaseClient, tempId: string, shift: S & { id: string }) {
  const booked = (await bookingsNear(db, [tempId], shift.shift_date)).get(tempId) ?? [];
  return booked.find((b) => b.id !== shift.id && overlaps(b, shift)) ?? null;
}
