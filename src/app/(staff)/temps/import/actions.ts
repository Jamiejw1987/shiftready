'use server';
import { revalidatePath } from 'next/cache';
import { requireStaff, audit } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { encrypt, decrypt, encryptionReady } from '@/lib/crypto';
import { toE164 } from '@/lib/phone';
import { geocodePostcodes, looksLikePostcode, normalisePostcode } from '@/lib/geo';
import { JOB_TYPES } from '@/lib/format';
import { niOk, type ImportRecord } from '@/lib/importParse';

export type ImportOptions = {
  source: string;                    // e.g. "KISREC", shown on each record
  dupes: 'skip' | 'fill';            // already on ShiftReady: leave alone, or fill in blanks (and add ongoing work)
  clientId: string | null;           // put everyone in this file down as ongoing at this client
  useClientColumn: boolean;          // or use each row's client column
  createClients: boolean;            // create clients from that column that aren't on ShiftReady yet
};
export type BatchResult = {
  ok: boolean; error?: string;
  added: number; updated: number; assigned: number; skipped: { row: number; reason: string }[]; clientsCreated: string[];
};

const todayUK = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const MAX = 300;

/** Is the database ready for imports (supabase/2026-11-16-ongoing-workers.sql run)? */
export async function importReady(): Promise<{ ok: boolean; error?: string; encryption: boolean }> {
  const { supabase } = await requireStaff({ admin: true });
  const { error } = await supabase.from('client_workers').select('id').limit(1);
  const { error: e2 } = await supabase.from('temps').select('no_comms,imported_at').limit(1);
  if (error || e2) return { ok: false, error: 'Run supabase/2026-11-16-ongoing-workers.sql in Supabase (SQL Editor) first, then reload this page.', encryption: encryptionReady() };
  return { ok: true, encryption: encryptionReady() };
}

/**
 * Brings workers in from another system WITHOUT sending them anything. Called in batches from the import page.
 * Everyone imported has messages switched off; they're matched to existing records by mobile, NI number, then old-system ID.
 */
export async function importBatch(records: ImportRecord[], opts: ImportOptions): Promise<BatchResult> {
  const { supabase, profile } = await requireStaff({ admin: true });
  const res: BatchResult = { ok: true, added: 0, updated: 0, assigned: 0, skipped: [], clientsCreated: [] };
  if (records.length > MAX) return { ...res, ok: false, error: `Send at most ${MAX} rows at a time.` };
  const ready = await importReady();
  if (!ready.ok) return { ...res, ok: false, error: ready.error };
  const sensitive = records.some((r) => r.ni || r.account);
  if (sensitive && !ready.encryption) return { ...res, ok: false, error: 'NI numbers and bank details can’t be saved: FIELD_ENCRYPTION_KEY isn’t set in Vercel.' };

  const admin = createAdminClient();
  const now = new Date().toISOString();
  const source = (opts.source || 'another system').replace(/\s+/g, ' ').trim().slice(0, 40);

  // ---- tidy and re-check on the server ----
  const rows = records.map((r) => {
    const ni = niOk((r.ni || '').toUpperCase()) ? r.ni.toUpperCase() : '';
    const bank = /^\d{6}$/.test(r.sortCode || '') && /^\d{8}$/.test(r.account || '') ? { name: (r.bankName || `${r.first} ${r.last}`).slice(0, 70), sortCode: r.sortCode, account: r.account } : null;
    const pc = looksLikePostcode(r.postcode) ? normalisePostcode(r.postcode) : null;
    return { r, e164: toE164(r.mobile), ni, bank, pc, types: (r.jobTypes || []).filter((t) => (JOB_TYPES as readonly string[]).includes(t)) };
  });

  // ---- who's already on ShiftReady ----
  const mobiles = rows.map((x) => x.e164).filter(Boolean) as string[];
  const refs = rows.map((x) => x.r.ref).filter(Boolean);
  const [{ data: byMob }, { data: byRef }] = await Promise.all([
    mobiles.length ? supabase.from('temps').select('id,mobile').in('mobile', mobiles) : Promise.resolve({ data: [] as { id: string; mobile: string }[] }),
    refs.length ? supabase.from('temps').select('id,external_ref').in('external_ref', refs) : Promise.resolve({ data: [] as { id: string; external_ref: string }[] }),
  ]);
  const mobId = new Map((byMob ?? []).map((t) => [t.mobile, t.id]));
  const refId = new Map((byRef ?? []).map((t) => [t.external_ref, t.id]));
  const niId = new Map<string, string>();
  if (rows.some((x) => x.ni)) {
    for (let from = 0; from < 100000; from += 1000) {
      const { data } = await admin.from('temp_profiles').select('temp_id,ni_enc').not('ni_enc', 'is', null).order('temp_id').range(from, from + 999);
      for (const p of data ?? []) { try { const v = decrypt<string>(p.ni_enc); if (v) niId.set(v.replace(/\s+/g, '').toUpperCase(), p.temp_id); } catch { /* unreadable: skip */ } }
      if (!data || data.length < 1000) break;
    }
  }

  // ---- clients ----
  const { data: clientList } = await supabase.from('clients').select('id,name');
  const clientByName = new Map((clientList ?? []).map((c) => [c.name.trim().toLowerCase(), c.id]));
  if (opts.clientId && !(clientList ?? []).some((c) => c.id === opts.clientId)) return { ...res, ok: false, error: 'That client wasn’t found.' };
  if (opts.useClientColumn && opts.createClients) {
    const missing = [...new Set(rows.map((x) => x.r.client.trim()).filter((n) => n && !clientByName.has(n.toLowerCase())))];
    for (const name of missing) {
      const { data: c, error } = await supabase.from('clients').insert({ name: name.slice(0, 80), cutoff_hours: 12, is_test: false, created_by: profile.id }).select('id,name').single();
      if (c) { clientByName.set(c.name.trim().toLowerCase(), c.id); res.clientsCreated.push(c.name); }
      else if (error?.code === '23505') {
        const { data: ex } = await supabase.from('clients').select('id,name').ilike('name', name).maybeSingle();
        if (ex) clientByName.set(ex.name.trim().toLowerCase(), ex.id);
      }
    }
  }
  const clientFor = (x: (typeof rows)[number]) => opts.clientId ?? (opts.useClientColumn && x.r.client ? clientByName.get(x.r.client.trim().toLowerCase()) ?? null : null);
  const { data: siteList } = await supabase.from('client_sites').select('id,client_id,name');
  const siteFor = (clientId: string, name: string) => (name ? (siteList ?? []).find((s) => s.client_id === clientId && s.name.trim().toLowerCase() === name.trim().toLowerCase())?.id ?? null : null);

  // ---- split into new and existing ----
  const seen = new Set<string>();
  const fresh: (typeof rows)[number][] = [];
  const existing: { x: (typeof rows)[number]; id: string }[] = [];
  for (const x of rows) {
    if (!x.r.first?.trim()) { res.skipped.push({ row: x.r.row, reason: 'No name' }); continue; }
    if (!x.e164) { res.skipped.push({ row: x.r.row, reason: x.r.mobile ? 'Not a UK mobile' : 'No mobile' }); continue; }
    if (seen.has(x.e164)) { res.skipped.push({ row: x.r.row, reason: 'Same mobile as another row in this file' }); continue; }
    seen.add(x.e164);
    const id = mobId.get(x.e164) ?? (x.ni ? niId.get(x.ni) : undefined) ?? (x.r.ref ? refId.get(x.r.ref) : undefined);
    if (id) {
      if (opts.dupes === 'skip') res.skipped.push({ row: x.r.row, reason: 'Already on ShiftReady' });
      else existing.push({ x, id });
    } else fresh.push(x);
  }

  // ---- add new workers (nothing is sent) ----
  const points = await geocodePostcodes(fresh.map((x) => x.pc).filter(Boolean) as string[]);
  const tempRow = (x: (typeof rows)[number]) => {
    const p = x.pc ? points.get(x.pc) : undefined;
    const ongoing = !!clientFor(x);
    return {
      first_name: x.r.first.trim(), last_name: x.r.last.trim() || '-', mobile: x.e164!, postcode: x.pc ?? (x.r.postcode ? x.r.postcode.slice(0, 10) : null),
      lat: p?.lat ?? null, lng: p?.lng ?? null, job_types: x.types, status: 'pending', added_by: profile.id,
      no_comms: true, no_comms_reason: ongoing ? 'ongoing' : 'imported', no_comms_at: now, no_comms_by: profile.id,
      imported_at: now, import_source: source, external_ref: x.r.ref || null,
      rtw_route: x.r.rtwRoute, rtw_checked_at: x.r.rtwRoute && x.r.rtwChecked ? `${x.r.rtwChecked}T12:00:00Z` : null, rtw_expires: x.r.rtwExpires,
      bank_on_file: !!x.bank,
    };
  };
  const idByMobile = new Map<string, string>();
  if (fresh.length) {
    const { data, error } = await supabase.from('temps').insert(fresh.map(tempRow)).select('id,mobile');
    if (!error && data) data.forEach((t) => idByMobile.set(t.mobile, t.id));
    else {
      // Something in the batch clashed (e.g. added by someone else a moment ago): add them one at a time.
      for (const x of fresh) {
        const { data: t, error: e } = await supabase.from('temps').insert(tempRow(x)).select('id,mobile').single();
        if (t) idByMobile.set(t.mobile, t.id);
        else res.skipped.push({ row: x.r.row, reason: e?.code === '23505' ? 'Already on ShiftReady' : 'Couldn’t save' });
      }
    }
    const profiles = fresh.filter((x) => idByMobile.has(x.e164!)).map((x) => ({
      temp_id: idByMobile.get(x.e164!)!, dob: x.r.dob, email: x.r.email || null, nationality: x.r.nationality || null,
      address1: x.r.address1 || null, address2: x.r.address2 || null, town: x.r.town || null, share_code: x.r.shareCode || null,
      ni_enc: x.ni ? encrypt(x.ni) : null,
      bank_enc: x.bank ? encrypt(x.bank) : null, bank_last4: x.bank ? x.bank.account.slice(-4) : null, bank_added_at: x.bank ? now : null,
      updated_at: now,
    }));
    if (profiles.length) {
      const { error: pe } = await admin.from('temp_profiles').upsert(profiles, { onConflict: 'temp_id' });
      if (pe) return { ...res, ok: false, error: `Workers were added but their details (address, NI, bank) couldn’t be saved: ${pe.message}. Re-run the import with "Fill in blanks" to finish them off.`, added: idByMobile.size };
    }
    res.added = idByMobile.size;
  }

  // ---- existing workers: fill in what's blank, never overwrite ----
  if (existing.length) {
    const ids = existing.map((e) => e.id);
    const [{ data: ts }, { data: ps }] = await Promise.all([
      supabase.from('temps').select('id,postcode,lat,rtw_route,rtw_checked_at,rtw_expires,external_ref,bank_on_file,job_types').in('id', ids),
      admin.from('temp_profiles').select('temp_id,dob,email,nationality,address1,address2,town,share_code,ni_enc,bank_enc').in('temp_id', ids),
    ]);
    const exPoints = await geocodePostcodes(existing.map((e) => e.x.pc).filter(Boolean) as string[]);
    for (const { x, id } of existing) {
      const t = ts?.find((r) => r.id === id), p = ps?.find((r) => r.temp_id === id);
      const tu: Record<string, unknown> = {};
      if (!t?.postcode && x.pc) { tu.postcode = x.pc; const pt = exPoints.get(x.pc); if (pt) { tu.lat = pt.lat; tu.lng = pt.lng; } }
      if (!t?.rtw_route && x.r.rtwRoute) { tu.rtw_route = x.r.rtwRoute; if (!t?.rtw_checked_at && x.r.rtwChecked) tu.rtw_checked_at = `${x.r.rtwChecked}T12:00:00Z`; }
      if (!t?.rtw_expires && x.r.rtwExpires) tu.rtw_expires = x.r.rtwExpires;
      if (!t?.external_ref && x.r.ref) tu.external_ref = x.r.ref;
      if (!t?.job_types?.length && x.types.length) tu.job_types = x.types;
      if (!t?.bank_on_file && x.bank) tu.bank_on_file = true;
      const pu: Record<string, unknown> = {};
      const fill = (k: string, v: unknown) => { if (v && !(p as Record<string, unknown> | undefined)?.[k]) pu[k] = v; };
      fill('dob', x.r.dob); fill('email', x.r.email); fill('nationality', x.r.nationality); fill('address1', x.r.address1);
      fill('address2', x.r.address2); fill('town', x.r.town); fill('share_code', x.r.shareCode);
      if (x.ni && !p?.ni_enc) pu.ni_enc = encrypt(x.ni);
      if (x.bank && !p?.bank_enc) { pu.bank_enc = encrypt(x.bank); pu.bank_last4 = x.bank.account.slice(-4); pu.bank_added_at = now; }
      if (Object.keys(tu).length) await supabase.from('temps').update(tu).eq('id', id);
      if (Object.keys(pu).length) await admin.from('temp_profiles').upsert({ temp_id: id, ...pu, updated_at: now }, { onConflict: 'temp_id' });
      if (Object.keys(tu).length || Object.keys(pu).length) res.updated++;
    }
  }

  // ---- ongoing work at clients ----
  const toAssign = [
    ...fresh.filter((x) => idByMobile.has(x.e164!)).map((x) => ({ x, id: idByMobile.get(x.e164!)! })),
    ...existing,
  ].map(({ x, id }) => ({ x, id, clientId: clientFor(x) })).filter((a) => a.clientId) as { x: (typeof rows)[number]; id: string; clientId: string }[];
  const unknownClients = new Set<string>();
  if (opts.useClientColumn && !opts.clientId) rows.forEach((x) => { if (x.r.client && !clientByName.has(x.r.client.trim().toLowerCase())) unknownClients.add(x.r.client); });
  if (toAssign.length) {
    const { data: open } = await supabase.from('client_workers').select('client_id,temp_id').in('temp_id', toAssign.map((a) => a.id)).is('end_date', null);
    const has = new Set((open ?? []).map((o) => `${o.client_id}:${o.temp_id}`));
    const today = todayUK();
    const ins = toAssign.filter((a) => !has.has(`${a.clientId}:${a.id}`)).map((a) => ({
      client_id: a.clientId, temp_id: a.id, site_id: siteFor(a.clientId, a.x.r.site),
      start_date: a.x.r.startDate && a.x.r.startDate <= today ? a.x.r.startDate : today,
      job_title: a.x.r.jobTitle || null, notes: `Imported from ${source}`, added_by: profile.id,
    }));
    if (ins.length) {
      const { error } = await supabase.from('client_workers').insert(ins);
      if (!error) res.assigned = ins.length;
      else for (const row of ins) { const { error: e } = await supabase.from('client_workers').insert(row); if (!e) res.assigned++; }
    }
    // Existing workers made ongoing: switch their messages off too.
    const exIds = existing.filter((e) => clientFor(e.x)).map((e) => e.id);
    if (exIds.length) await supabase.from('temps').update({ no_comms: true, no_comms_reason: 'ongoing', no_comms_at: now, no_comms_by: profile.id }).in('id', exIds);
  }

  await audit(supabase, profile.id, 'temp.imported',
    `Imported from ${source} (no messages sent): ${res.added} added, ${res.updated} existing filled in, ${res.assigned} marked ongoing at a client, ${res.skipped.length} skipped${res.clientsCreated.length ? `. New clients: ${res.clientsCreated.join(', ')}` : ''}${unknownClients.size ? `. Clients not found: ${[...unknownClients].slice(0, 5).join(', ')}` : ''}`);
  revalidatePath('/temps');
  return res;
}
