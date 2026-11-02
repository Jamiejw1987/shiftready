'use server';
import { createAdminClient } from '@/lib/supabase/admin';
import { toE164 } from '@/lib/phone';
import { sendToTemp } from '@/lib/sms';
import { appUrl, regInviteText } from '@/lib/texts';
import { currentDocs, docProblems } from '@/lib/docs';
import { encryptionReady } from '@/lib/crypto';

/**
 * Public sign-up: anyone with the link enters their name and mobile, and we text them their own registration link.
 * Texting the link (rather than opening the form straight away) proves the mobile is really theirs.
 */
export async function joinUp(input: { first: string; last: string; mobile: string; consent: boolean; website: string; from: string }) {
  if (input.website) return { ok: true }; // hidden field: only bots fill it in
  const first = input.first.replace(/\s+/g, ' ').trim().slice(0, 60);
  const last = input.last.replace(/\s+/g, ' ').trim().slice(0, 60);
  const mobile = toE164(input.mobile);
  if (!first || !last) return { ok: false, error: 'Please enter your first name and surname.' };
  if (!mobile) return { ok: false, error: 'Please enter a UK mobile number starting 07.' };
  if (!input.consent) return { ok: false, error: 'Please tick the box so we can text you your registration link.' };

  const db = createAdminClient();
  if (!encryptionReady() || docProblems(await currentDocs(db)).length) return { ok: false, error: 'Registration isn’t open just now. Please try again later.' };

  // Light protection against someone hammering the form.
  const hourAgo = new Date(Date.now() - 3600e3).toISOString();
  const { count: recent } = await db.from('messages').select('id', { count: 'exact', head: true }).eq('kind', 'registration').is('sent_by', null).gte('created_at', hourAgo);
  if ((recent ?? 0) > 300) return { ok: false, error: 'We’re very busy right now. Please try again in an hour.' };

  const source = input.from.replace(/[^a-z0-9 _-]/gi, '').slice(0, 30);
  const { data: existing } = await db.from('temps').select('id,first_name,mobile,status,reg_token,registered_at,reg_requested_at').eq('mobile', mobile).maybeSingle();
  if (existing) {
    // Don't send more than one text every 10 minutes to the same number.
    const tenAgo = new Date(Date.now() - 600e3).toISOString();
    const { count } = await db.from('messages').select('id', { count: 'exact', head: true }).eq('temp_id', existing.id).eq('direction', 'out').gte('created_at', tenAgo);
    if (!count && existing.status !== 'out') {
      const body = existing.registered_at
        ? `Hi ${existing.first_name}, you're already registered with Staff Selection UK. Your page: ${appUrl()}/me/${existing.reg_token} - Staff Selection`
        : regInviteText(existing.first_name, existing.reg_token);
      if (!existing.registered_at && !existing.reg_requested_at) await db.from('temps').update({ reg_requested_at: new Date().toISOString() }).eq('id', existing.id);
      await sendToTemp({ db, temp: existing, kind: 'registration', body });
    }
    return { ok: true };
  }

  const { data: t, error } = await db.from('temps')
    .insert({ first_name: first, last_name: last, mobile, status: 'invited', job_types: [], reg_requested_at: new Date().toISOString() })
    .select('id,mobile,reg_token').single();
  if (error || !t) return { ok: false, error: 'Something went wrong. Please try again.' };
  await sendToTemp({ db, temp: t, kind: 'registration', body: regInviteText(first, t.reg_token) });
  await db.from('audit_log').insert({ actor: null, action: 'temp.self_signup', detail: `${first} ${last} signed up through the public link${source ? ` (from ${source})` : ''}` });
  return { ok: true };
}
