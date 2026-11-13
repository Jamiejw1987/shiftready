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

/* ---------- Weekly hours limit (e.g. students limited to 20 hours a week) ---------- */

/** Monday and Sunday (YYYY-MM-DD) of the week this date falls in. A shift counts in the week it starts. */
export function weekOf(date: string): [string, string] {
  const d = new Date(date + 'T12:00:00Z');
  const mon = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 864e5);
  return [mon.toISOString().slice(0, 10), new Date(mon.getTime() + 6 * 864e5).toISOString().slice(0, 10)];
}

/** Weekly hour limits for these temps. Only temps with a limit are in the map. */
export async function hourCaps(db: SupabaseClient, tempIds: string[]) {
  const out = new Map<string, number>();
  for (let i = 0; i < tempIds.length; i += 300) {
    const { data, error } = await db.from('temps').select('id,hours_cap').in('id', tempIds.slice(i, i + 300)).not('hours_cap', 'is', null);
    if (error) return out; // column not added yet (migration not run): no limits
    for (const r of data ?? []) out.set(r.id, Number(r.hours_cap));
  }
  return out;
}

/** Hours each temp is booked for in the Mon-Sun week containing `date` (not counting `exceptShiftId`). */
export async function weekHours(db: SupabaseClient, tempIds: string[], date: string, exceptShiftId?: string) {
  const [from, to] = weekOf(date);
  const out = new Map<string, number>();
  for (let i = 0; i < tempIds.length; i += 300) {
    const { data } = await db.from('offers')
      .select('temp_id, shifts!inner(id,shift_date,start_time,end_time,status)')
      .in('temp_id', tempIds.slice(i, i + 300)).eq('status', 'accepted')
      .gte('shifts.shift_date', from).lte('shifts.shift_date', to).neq('shifts.status', 'cancelled');
    for (const r of data ?? []) {
      const s = r.shifts as unknown as S & { id: string };
      if (s.id === exceptShiftId) continue;
      out.set(r.temp_id, (out.get(r.temp_id) ?? 0) + shiftHours(s));
    }
  }
  return out;
}

export type OverCap = { cap: number; used: number; after: number };

/** Temps who'd go over their weekly limit if booked on `shift`. Temps without a limit are never in the map. */
export async function overCap(db: SupabaseClient, tempIds: string[], shift: S & { id: string }) {
  const out = new Map<string, OverCap>();
  const caps = await hourCaps(db, tempIds);
  if (!caps.size) return out;
  const used = await weekHours(db, [...caps.keys()], shift.shift_date, shift.id);
  const add = shiftHours(shift);
  caps.forEach((cap, id) => {
    const u = used.get(id) ?? 0;
    if (u + add > cap + 1e-6) out.set(id, { cap, used: u, after: u + add });
  });
  return out;
}

const h = (n: number) => `${Math.round(n * 100) / 100}`;
/** e.g. "Sam can only work 20 hours a week and already has 16 booked that week (this shift would make 24)." */
export const capMessage = (first: string, c: OverCap) =>
  `${first} can only work ${c.cap} hours a week and already has ${h(c.used)} booked that week (this shift would make ${h(c.after)}).`;
