'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { clientAudit, sendClientLink } from '@/lib/clients';
import { geocodePostcode, looksLikePostcode, normalisePostcode } from '@/lib/geo';

type Result = { ok: boolean; error?: string; message?: string; link?: string | null };
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function createClientAccount(input: { name: string; cutoff: number; isTest: boolean }): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const name = input.name.trim().slice(0, 80);
  if (!name) return { ok: false, error: 'Enter the client’s name.' };
  const cutoff = Math.round(input.cutoff);
  if (!(cutoff >= 0 && cutoff <= 168)) return { ok: false, error: 'Notice period must be 0 to 168 hours.' };
  const { data, error } = await supabase.from('clients').insert({ name, cutoff_hours: cutoff, is_test: input.isTest, created_by: profile.id }).select('id').single();
  if (error || !data) return { ok: false, error: error?.code === '23505' ? 'There’s already a client with that name.' : 'Couldn’t save. Try again.' };
  await clientAudit(supabase, { actor: profile.id, action: 'client.created', clientId: data.id, entity: 'client', entityId: data.id, detail: `${profile.full_name} added client ${name}${input.isTest ? ' (test client)' : ''}` });
  redirect(`/clients/${data.id}`);
}

export async function updateClientAccount(id: string, input: { name: string; cutoff: number; isTest: boolean; active: boolean }): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const { data: c } = await supabase.from('clients').select('name,cutoff_hours,is_test,active').eq('id', id).maybeSingle();
  if (!c) return { ok: false, error: 'Not found.' };
  const name = input.name.trim().slice(0, 80);
  const cutoff = Math.round(input.cutoff);
  if (!name) return { ok: false, error: 'Enter the client’s name.' };
  if (!(cutoff >= 0 && cutoff <= 168)) return { ok: false, error: 'Notice period must be 0 to 168 hours.' };
  if (!input.active && profile.role !== 'admin') return { ok: false, error: 'Only admins can switch a client off.' };
  const { error } = await supabase.from('clients').update({ name, cutoff_hours: cutoff, is_test: input.isTest, active: input.active }).eq('id', id);
  if (error) return { ok: false, error: error.code === '23505' ? 'There’s already a client with that name.' : 'Couldn’t save.' };
  await clientAudit(supabase, { actor: profile.id, action: 'client.updated', clientId: id, entity: 'client', entityId: id, detail: `${profile.full_name} updated ${name}'s settings`, before: c, after: { name, cutoff_hours: cutoff, is_test: input.isTest, active: input.active } });
  revalidatePath(`/clients/${id}`);
  return { ok: true, message: 'Saved.' };
}

export async function saveSite(clientId: string, siteId: string | null, input: { name: string; address: string; postcode: string; active: boolean }): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const name = input.name.trim().slice(0, 60), address = input.address.trim().slice(0, 200);
  if (!name || !address) return { ok: false, error: 'Enter the site name and address.' };
  if (!looksLikePostcode(input.postcode)) return { ok: false, error: 'Enter the site’s full postcode.' };
  const postcode = normalisePostcode(input.postcode);
  const point = await geocodePostcode(postcode);
  if (!point) return { ok: false, error: `We couldn’t find the postcode ${postcode}.` };
  const row = { name, address, postcode, lat: point.lat, lng: point.lng, active: input.active };
  if (siteId) {
    const { data: before } = await supabase.from('client_sites').select('name,address,postcode,active').eq('id', siteId).eq('client_id', clientId).maybeSingle();
    if (!before) return { ok: false, error: 'Site not found.' };
    await supabase.from('client_sites').update(row).eq('id', siteId);
    await clientAudit(supabase, { actor: profile.id, action: 'site.updated', clientId, entity: 'site', entityId: siteId, detail: `${profile.full_name} updated the ${name} site`, before, after: row });
  } else {
    const { data } = await supabase.from('client_sites').insert({ client_id: clientId, ...row }).select('id').single();
    await clientAudit(supabase, { actor: profile.id, action: 'site.added', clientId, entity: 'site', entityId: data?.id ?? null, detail: `${profile.full_name} added the ${name} site (${postcode})` });
  }
  revalidatePath(`/clients/${clientId}`);
  return { ok: true, message: 'Site saved.' };
}

/** Gives someone at the client their own sign-in, and emails them a personal link. */
export async function inviteClientUser(clientId: string, input: { email: string; name: string; siteIds: string[] | null }): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const email = input.email.trim().toLowerCase();
  if (!EMAIL.test(email)) return { ok: false, error: 'Enter a valid email address.' };
  const db = createAdminClient();
  const { data: client } = await db.from('clients').select('id,name,active').eq('id', clientId).maybeSingle();
  if (!client?.active) return { ok: false, error: 'This client is switched off.' };
  const { data: staff } = await db.from('profiles').select('id').ilike('email', email).maybeSingle();
  if (staff) return { ok: false, error: 'That’s a Staff Selection login. For testing, use another address, e.g. yourname+dhl@staffselectionuk.com.' };
  const { data: existing } = await db.from('client_users').select('id,client_id,auth_user_id,status,full_name').eq('email', email).maybeSingle();
  if (existing && existing.client_id !== clientId) return { ok: false, error: 'That email is already set up for another client.' };
  if (existing && existing.status !== 'removed') return { ok: false, error: 'They already have access. Use Resend link instead.' };

  // Their sign-in. Kept separate from staff: no profile, no password, no two-step sign-in.
  let authId = existing?.auth_user_id ?? null;
  if (authId) await db.auth.admin.updateUserById(authId, { ban_duration: 'none' });
  else {
    const { data: made, error } = await db.auth.admin.createUser({ email, email_confirm: true, app_metadata: { kind: 'client' } });
    if (error || !made.user) {
      if (!error?.message.toLowerCase().includes('already')) return { ok: false, error: `Couldn’t create their sign-in: ${error?.message}` };
      return { ok: false, error: 'That email already has a ShiftReady sign-in. Ask your developer to check it in Supabase.' };
    }
    authId = made.user.id;
  }
  const siteIds = input.siteIds?.length ? input.siteIds : null;
  const row = { client_id: clientId, auth_user_id: authId, email, full_name: input.name.trim() || existing?.full_name || null, all_sites: !siteIds, status: 'invited', invited_by: profile.id, invited_at: new Date().toISOString(), removed_at: null };
  const { data: cu, error: e2 } = existing
    ? await db.from('client_users').update(row).eq('id', existing.id).select('id,email,full_name').single()
    : await db.from('client_users').insert(row).select('id,email,full_name').single();
  if (e2 || !cu) return { ok: false, error: 'Couldn’t save them. Try again.' };
  await db.from('client_user_sites').delete().eq('client_user_id', cu.id);
  if (siteIds) await db.from('client_user_sites').insert(siteIds.map((site_id) => ({ client_user_id: cu.id, site_id })));
  const sent = await sendClientLink(db, cu, client.name, true);
  await clientAudit(supabase, { actor: profile.id, action: 'client_user.invited', clientId, entity: 'client_user', entityId: cu.id, detail: `${profile.full_name} invited ${email} to the ${client.name} portal${sent.ok ? '' : ' (email failed)'}` });
  revalidatePath(`/clients/${clientId}`);
  if (!sent.ok) return { ok: false, error: `They’re set up, but the email failed: ${sent.error}. Try Resend link.` };
  return { ok: true, message: sent.dryRunLink ? 'Set up. Email isn’t switched on, so here’s their link to test with:' : `Invite emailed to ${email}.`, link: sent.dryRunLink };
}

export async function resendClientLink(clientUserId: string): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const db = createAdminClient();
  const { data: cu } = await db.from('client_users').select('id,client_id,email,full_name,status,joined_at,clients(name)').eq('id', clientUserId).maybeSingle();
  if (!cu || cu.status === 'removed') return { ok: false, error: 'They don’t have access.' };
  const name = (cu.clients as unknown as { name: string }).name;
  const sent = await sendClientLink(db, cu, name, !cu.joined_at);
  await clientAudit(supabase, { actor: profile.id, action: 'client_user.link_resent', clientId: cu.client_id, entity: 'client_user', entityId: cu.id, detail: `${profile.full_name} sent ${cu.email} a new sign-in link` });
  if (!sent.ok) return { ok: false, error: `Email failed: ${sent.error}` };
  return { ok: true, message: sent.dryRunLink ? 'Email isn’t switched on, so here’s the link to test with:' : `Sign-in link emailed to ${cu.email}.`, link: sent.dryRunLink };
}

/** Removes access straight away: the portal checks on every page, and their sign-in is blocked. */
export async function removeClientUser(clientUserId: string): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const db = createAdminClient();
  const { data: cu } = await db.from('client_users').select('id,client_id,email,full_name,auth_user_id,status').eq('id', clientUserId).maybeSingle();
  if (!cu || cu.status === 'removed') return { ok: false, error: 'Already removed.' };
  await db.from('client_users').update({ status: 'removed', removed_at: new Date().toISOString() }).eq('id', cu.id);
  if (cu.auth_user_id) await db.auth.admin.updateUserById(cu.auth_user_id, { ban_duration: '876000h' });
  await clientAudit(supabase, { actor: profile.id, action: 'client_user.removed', clientId: cu.client_id, entity: 'client_user', entityId: cu.id, detail: `${profile.full_name} removed ${cu.full_name || cu.email}'s portal access` });
  revalidatePath(`/clients/${cu.client_id}`);
  return { ok: true, message: 'Access removed.' };
}

export async function setUserSites(clientUserId: string, siteIds: string[] | null): Promise<Result> {
  const { supabase, profile } = await requireStaff();
  const db = createAdminClient();
  const { data: cu } = await db.from('client_users').select('id,client_id,email,full_name').eq('id', clientUserId).maybeSingle();
  if (!cu) return { ok: false, error: 'Not found.' };
  const { data: sites } = await db.from('client_sites').select('id,name').eq('client_id', cu.client_id);
  const ids = siteIds?.filter((x) => (sites ?? []).some((s) => s.id === x)) ?? null;
  if (ids && !ids.length) return { ok: false, error: 'Choose at least one site, or All sites.' };
  await db.from('client_user_sites').delete().eq('client_user_id', cu.id);
  if (ids) await db.from('client_user_sites').insert(ids.map((site_id) => ({ client_user_id: cu.id, site_id })));
  await db.from('client_users').update({ all_sites: !ids }).eq('id', cu.id);
  const names = ids ? (sites ?? []).filter((s) => ids.includes(s.id)).map((s) => s.name).join(', ') : 'all sites';
  await clientAudit(supabase, { actor: profile.id, action: 'client_user.sites', clientId: cu.client_id, entity: 'client_user', entityId: cu.id, detail: `${profile.full_name} set ${cu.full_name || cu.email}'s sites to ${names}` });
  revalidatePath(`/clients/${cu.client_id}`);
  return { ok: true, message: 'Sites saved.' };
}

/** Admins can let someone a client blocked work for them again. */
export async function liftBlock(blockId: string, note: string): Promise<Result> {
  const { supabase, profile } = await requireStaff({ admin: true });
  const { data: b } = await supabase.from('client_blocks').select('id,client_id,temp_id,lifted_at,temps(first_name,last_name),clients(name)').eq('id', blockId).maybeSingle();
  if (!b || b.lifted_at) return { ok: false, error: 'Already lifted.' };
  await supabase.from('client_blocks').update({ lifted_at: new Date().toISOString(), lifted_by: profile.id, lift_note: note.trim().slice(0, 300) || null }).eq('id', b.id);
  const t = b.temps as unknown as { first_name: string; last_name: string };
  const c = b.clients as unknown as { name: string };
  await clientAudit(supabase, { actor: profile.id, action: 'block.lifted', clientId: b.client_id, entity: 'temp', entityId: b.temp_id, detail: `${profile.full_name} lifted ${c.name}'s block on ${t.first_name} ${t.last_name}${note.trim() ? `: ${note.trim()}` : ''}` });
  revalidatePath(`/clients/${b.client_id}`);
  revalidatePath(`/temps/${b.temp_id}`);
  return { ok: true, message: 'Block lifted.' };
}
