'use server';
import { requireStaff, audit } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { encryptionReady } from '@/lib/crypto';
import { parseTimesheets, loadTemps, matchPeople, payrollWorkbook, TimesheetError, type ConvertResult } from '@/lib/timesheets';
import { matchStarters, startersWorkbook, type StarterResult } from '@/lib/starters';

/** Admins and the people ticked as payroll contacts on the Team page. */
async function payrollStaff() {
  const s = await requireStaff();
  if (s.profile.role !== 'admin' && !s.profile.payroll) return null;
  return s;
}

export async function checkStarters(text: string): Promise<{ ok: boolean; error?: string; result?: StarterResult }> {
  if (!(await payrollStaff())) return { ok: false, error: 'Only admins and payroll contacts can use this.' };
  if (!encryptionReady()) return { ok: false, error: 'Encryption key missing. Check FIELD_ENCRYPTION_KEY in Vercel.' };
  try {
    return { ok: true, result: await matchStarters(createAdminClient(), text.slice(0, 100_000)) };
  } catch {
    return { ok: false, error: 'Couldn’t check the list. Try again.' };
  }
}

/** Re-checks the list on the server and returns the Excel file (base64). Every download is logged with the names in it. */
export async function downloadStarters(text: string): Promise<{ ok: boolean; error?: string; file?: string; count?: number }> {
  const s = await payrollStaff();
  if (!s) return { ok: false, error: 'Only admins and payroll contacts can use this.' };
  try {
    const db = createAdminClient();
    const r = await matchStarters(db, text.slice(0, 100_000));
    if (!r.matched.length) return { ok: false, error: 'Nobody on the list matched, so there’s nothing to download.' };
    const buf = await startersWorkbook(db, r.matched.map((m) => m.id));
    const names = r.matched.map((m) => m.name);
    await audit(s.supabase, s.profile.id, 'payroll.starters_downloaded',
      `Downloaded payroll details (incl. NI and bank) for ${names.length}: ${names.join(', ')}`.slice(0, 4000));
    return { ok: true, file: buf.toString('base64'), count: names.length };
  } catch {
    return { ok: false, error: 'Couldn’t build the file. Check FIELD_ENCRYPTION_KEY in Vercel hasn’t changed, then try again.' };
  }
}

// ---------- Timesheet converter: client timesheet export → our payroll layout, with NI numbers from ShiftReady ----------


const MAX_FILE = 5 * 1024 * 1024;

async function convert(fileB64: string) {
  const buf = Buffer.from(fileB64, 'base64');
  if (!buf.length) throw new TimesheetError('Choose a file first.');
  if (buf.length > MAX_FILE) throw new TimesheetError('That file is too big. Timesheet exports are usually well under 1 MB.');
  const db = createAdminClient();
  const parsed = await parseTimesheets(buf);
  if (!parsed.people.length) throw new TimesheetError('No workers found in that file.');
  return { db, result: matchPeople(parsed, await loadTemps(db)) };
}

const why = (e: unknown, fallback: string) => (e instanceof TimesheetError ? e.message : fallback);

/** Reads the file and matches each worker to a temp. Returns names and hours only, never NI numbers. */
export async function checkTimesheets(fileB64: string): Promise<{ ok: boolean; error?: string; result?: ConvertResult }> {
  if (!(await payrollStaff())) return { ok: false, error: 'Only admins and payroll contacts can use this.' };
  try {
    return { ok: true, result: (await convert(fileB64)).result };
  } catch (e) {
    return { ok: false, error: why(e, 'Couldn’t read that file. Try again.') };
  }
}

/** Re-reads the file on the server, applies the choices made for names that needed checking, and returns the payroll Excel. Logged. */
export async function downloadTimesheets(fileB64: string, choices: Record<string, string>): Promise<{ ok: boolean; error?: string; file?: string; name?: string; count?: number; missing?: number }> {
  const s = await payrollStaff();
  if (!s) return { ok: false, error: 'Only admins and payroll contacts can use this.' };
  if (!encryptionReady()) return { ok: false, error: 'Encryption key missing. Check FIELD_ENCRYPTION_KEY in Vercel.' };
  try {
    const { db, result } = await convert(fileB64);
    // Only accept a choice that was offered for that row (or "none").
    const clean: Record<string, string> = {};
    for (const r of result.rows) {
      const c = choices?.[r.key];
      if (c === 'none' || (c && r.suggestions.some((x) => x.id === c))) clean[r.key] = c;
      else if (r.status === 'check') return { ok: false, error: `Choose who “${r.fileName}” is (or leave their NI blank) before downloading.` };
    }
    const { file, used } = await payrollWorkbook(db, result, clean);
    const missing = used.filter((u) => !u.ni).length;
    await audit(s.supabase, s.profile.id, 'payroll.timesheets_converted',
      `Converted ${result.client || 'client'} timesheets (week ending ${result.weekEnding || '?'}) to payroll layout incl. NI numbers for ${used.length - missing} of ${used.length}: ${used.map((u) => u.name).join(', ')}`.slice(0, 4000));
    const slug = (result.client || 'timesheets').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const we = result.weekEnding.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    const date = we ? `${we[3]}-${we[2].padStart(2, '0')}-${we[1].padStart(2, '0')}` : new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
    return { ok: true, file: file.toString('base64'), name: `payroll-${slug}-we-${date}.xlsx`, count: used.length, missing };
  } catch (e) {
    return { ok: false, error: why(e, 'Couldn’t build the file. Check FIELD_ENCRYPTION_KEY in Vercel hasn’t changed, then try again.') };
  }
}
