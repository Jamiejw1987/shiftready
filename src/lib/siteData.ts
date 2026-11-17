import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { IND_COLS, docsFor, statusOf, type IndStatus, type TempInduction } from '@/lib/inductions';
import { siteDays, type Supervisor } from '@/lib/siteAuth';

export type SiteRow = {
  offerId: string; tempId: string; name: string; shift: { client: string; site: string; date: string; start: string; end: string };
  induction: { id: string; pack: string; status: IndStatus; signed: boolean; checked: boolean; siteDone: boolean; site: string; mh: 'none' | 'todo' | 'done' } | null;
};

/**
 * Temps booked on today's (and last night's) shifts that this supervisor can see, with their induction for that client.
 * Supervisors see names and induction status only.
 */
export async function bookedForSupervisor(sup: Supervisor): Promise<SiteRow[]> {
  const db = createAdminClient();
  const { today, yesterday } = siteDays();
  let q = db.from('shifts').select('id,client,client_id,site,shift_date,start_time,end_time').in('shift_date', [yesterday, today]).neq('status', 'cancelled');
  if (sup.client_id) q = q.eq('client_id', sup.client_id);
  const { data: shifts } = await q;
  // Yesterday only counts for night shifts still running past midnight.
  const list = (shifts ?? []).filter((s) => s.shift_date === today || s.end_time <= s.start_time);
  if (!list.length) return [];
  const { data: offers } = await db.from('offers').select('id,shift_id,temp_id,temps(first_name,last_name)').in('shift_id', list.map((s) => s.id)).eq('status', 'accepted');
  const tempIds = Array.from(new Set((offers ?? []).map((o) => o.temp_id)));
  const { data: inds } = tempIds.length
    ? await db.from('temp_inductions').select(`${IND_COLS},induction_packs(name,client_id,default_site)`).in('temp_id', tempIds).is('cancelled_at', null).order('sent_at', { ascending: false })
    : { data: [] };
  type Ind = TempInduction & { induction_packs: { name: string; client_id: string | null; default_site: string | null } | null };
  const allInds = (inds ?? []) as unknown as Ind[];
  // Which packs include the manual handling assessment sheets, and who has already been assessed.
  const docIds = Array.from(new Set(allInds.flatMap((i) => i.doc_ids)));
  const mhDocs = new Set((await docsFor(db, docIds)).filter((d) => /manual handling practical/i.test(d.title)).map((d) => d.id));
  const { data: done } = allInds.length ? await db.from('induction_assessments').select('induction_id').in('induction_id', allInds.map((i) => i.id)) : { data: [] };
  const assessed = new Set((done ?? []).map((d) => d.induction_id));
  const rows: SiteRow[] = [];
  for (const o of offers ?? []) {
    const s = list.find((x) => x.id === o.shift_id)!;
    const t = o.temps as unknown as { first_name: string; last_name: string };
    const mine = allInds.filter((i) => i.temp_id === o.temp_id);
    const i = mine.find((x) => x.induction_packs?.client_id && x.induction_packs.client_id === s.client_id)
      ?? mine.find((x) => !x.induction_packs?.client_id) ?? (sup.client_id ? null : mine[0] ?? null);
    rows.push({
      offerId: o.id, tempId: o.temp_id, name: `${t.first_name} ${t.last_name}`,
      shift: { client: s.client, site: s.site, date: s.shift_date, start: s.start_time.slice(0, 5), end: s.end_time.slice(0, 5) },
      induction: i ? { id: i.id, pack: i.induction_packs?.name ?? 'Induction', status: statusOf(i), signed: !!i.signed_at, checked: !!i.checked_at, siteDone: !!i.site_signed_at,
        site: i.answers?.site || i.induction_packs?.default_site || s.site, mh: i.doc_ids.some((x) => mhDocs.has(x)) ? (assessed.has(i.id) ? 'done' : 'todo') : 'none' } : null,
    });
  }
  return rows.sort((a, b) => a.shift.start.localeCompare(b.shift.start) || a.name.localeCompare(b.name));
}

export async function supervisorCanSee(sup: Supervisor, inductionId: string) {
  const rows = await bookedForSupervisor(sup);
  return rows.some((r) => r.induction?.id === inductionId);
}
