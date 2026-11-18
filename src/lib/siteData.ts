import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { IND_COLS, docsFor, statusOf, type IndStatus, type TempInduction } from '@/lib/inductions';
import { siteDays, type Supervisor } from '@/lib/siteAuth';

export type SiteRow = {
  key: string; tempId: string; name: string;
  /** Their shift today, if they're booked; null for someone who's been sent the induction but isn't booked today. */
  shift: { client: string; site: string; date: string; start: string; end: string } | null;
  induction: { id: string; pack: string; status: IndStatus; signed: boolean; checked: boolean; siteDone: boolean; site: string; mh: 'none' | 'todo' | 'done'; form: boolean } | null;
};

type Ind = TempInduction & { induction_packs: { name: string; client_id: string | null; default_site: string | null } | null; temps: { first_name: string; last_name: string } | null };

/**
 * Who the site supervisor can see: everyone booked on today's (and last night's) shifts, plus everyone who has
 * been sent this client's induction and hasn't finished day one yet, booked or not.
 * Supervisors see names and induction status only.
 */
export async function bookedForSupervisor(sup: Supervisor): Promise<SiteRow[]> {
  const db = createAdminClient();
  const { today, yesterday } = siteDays();

  // 1. Booked today.
  let q = db.from('shifts').select('id,client,client_id,site,shift_date,start_time,end_time').in('shift_date', [yesterday, today]).neq('status', 'cancelled');
  if (sup.client_id) q = q.eq('client_id', sup.client_id);
  const { data: shifts } = await q;
  const list = (shifts ?? []).filter((s) => s.shift_date === today || s.end_time <= s.start_time);   // last night's only if it ran past midnight
  const { data: offers } = list.length
    ? await db.from('offers').select('id,shift_id,temp_id,temps(first_name,last_name)').in('shift_id', list.map((s) => s.id)).eq('status', 'accepted')
    : { data: [] };

  // 2. Every live induction for this supervisor's client (or every client if they're not tied to one).
  const sel = `${IND_COLS},induction_packs!inner(name,client_id,default_site),temps(first_name,last_name)`;
  let iq = db.from('temp_inductions').select(sel).is('cancelled_at', null).order('sent_at', { ascending: false }).limit(500);
  if (sup.client_id) iq = iq.eq('induction_packs.client_id', sup.client_id);
  const { data: liveRaw } = await iq;
  const bookedIds = Array.from(new Set((offers ?? []).map((o) => o.temp_id)));
  const { data: bookedIndsRaw } = bookedIds.length
    ? await db.from('temp_inductions').select(sel).in('temp_id', bookedIds).is('cancelled_at', null).order('sent_at', { ascending: false })
    : { data: [] };
  const byId = new Map<string, Ind>();
  for (const i of [...((liveRaw ?? []) as unknown as Ind[]), ...((bookedIndsRaw ?? []) as unknown as Ind[])]) byId.set(i.id, i);
  const allInds = Array.from(byId.values());

  // Which packs include the manual handling assessment sheets, and who has already been assessed.
  const docIds = Array.from(new Set(allInds.flatMap((i) => i.doc_ids)));
  const allDocs = await docsFor(db, docIds);
  const mhDocs = new Set(allDocs.filter((d) => /manual handling practical/i.test(d.title)).map((d) => d.id));
  const formDocs = new Set(allDocs.filter((d) => d.template === 'evri_hse_v12').map((d) => d.id));
  const { data: done } = allInds.length ? await db.from('induction_assessments').select('induction_id').eq('kind', 'mh_practical').in('induction_id', allInds.map((i) => i.id)) : { data: [] };
  const assessed = new Set((done ?? []).map((d) => d.induction_id));

  const view = (i: Ind, site: string): NonNullable<SiteRow['induction']> => ({
    id: i.id, pack: i.induction_packs?.name ?? 'Induction', status: statusOf(i), signed: !!i.signed_at, checked: !!i.checked_at, siteDone: !!i.site_signed_at,
    site: i.answers?.site || i.induction_packs?.default_site || site,
    mh: i.doc_ids.some((x) => mhDocs.has(x)) ? (assessed.has(i.id) ? 'done' : 'todo') : 'none',
    form: i.doc_ids.some((x) => formDocs.has(x)),
  });

  const rows: SiteRow[] = [];
  const shown = new Set<string>();
  for (const o of offers ?? []) {
    const s = list.find((x) => x.id === o.shift_id)!;
    const t = o.temps as unknown as { first_name: string; last_name: string };
    const mine = allInds.filter((i) => i.temp_id === o.temp_id);
    const i = mine.find((x) => x.induction_packs?.client_id && x.induction_packs.client_id === s.client_id)
      ?? mine.find((x) => !x.induction_packs?.client_id) ?? (sup.client_id ? null : mine[0] ?? null);
    if (i) shown.add(i.id);
    rows.push({
      key: `o:${o.id}`, tempId: o.temp_id, name: `${t.first_name} ${t.last_name}`,
      shift: { client: s.client, site: s.site, date: s.shift_date, start: s.start_time.slice(0, 5), end: s.end_time.slice(0, 5) },
      induction: i ? view(i, s.site) : null,
    });
  }
  // Sent the induction, not booked today, day one not finished yet.
  const others: SiteRow[] = [];
  for (const i of allInds) {
    if (shown.has(i.id) || (sup.client_id && i.induction_packs?.client_id !== sup.client_id)) continue;
    const v = view(i, '');
    const dayOneDone = v.siteDone && v.mh !== 'todo';
    if (dayOneDone) continue;
    shown.add(i.id);
    others.push({ key: `i:${i.id}`, tempId: i.temp_id, name: `${i.temps?.first_name ?? ''} ${i.temps?.last_name ?? ''}`.trim(), shift: null, induction: v });
  }
  rows.sort((a, b) => a.shift!.start.localeCompare(b.shift!.start) || a.name.localeCompare(b.name));
  others.sort((a, b) => a.name.localeCompare(b.name));
  return [...rows, ...others];
}

export async function supervisorCanSee(sup: Supervisor, inductionId: string) {
  const rows = await bookedForSupervisor(sup);
  return rows.some((r) => r.induction?.id === inductionId);
}
