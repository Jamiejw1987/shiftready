import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { appUrl } from './texts';
import { sendEmail, esc, clientStream } from './email';

/**
 * Emails a consultant a link to set (or reset) their ShiftReady password.
 *
 * Supabase makes the one-time link; ShiftReady emails it through Postmark. Supabase's own emails are
 * rate-limited to a couple an hour and often never arrive, which is why invites and resets used to vanish.
 *
 * The link opens /auth/confirm, which only uses it when the person presses Continue, so Outlook's
 * link scanner (Safe Links) opening it first doesn't burn it.
 *
 * `invite` creates the account if it doesn't exist yet; otherwise it's a password reset.
 */
export async function sendStaffLink(db: SupabaseClient, p: { email: string; full_name: string }, invite: boolean) {
  const email = p.email.trim().toLowerCase();
  let gen = await db.auth.admin.generateLink({ type: invite ? 'invite' : 'recovery', email });
  // An invite for someone who already has an account (e.g. resending) falls back to a reset link.
  if (invite && gen.error && /already|registered|exists/i.test(gen.error.message)) {
    gen = await db.auth.admin.generateLink({ type: 'recovery', email });
  }
  const { data, error } = gen;
  if (error || !data?.properties?.hashed_token || !data.user) return { ok: false as const, error: error?.message || 'Could not make a link.' };

  const type = data.properties.verification_type || (invite ? 'invite' : 'recovery');
  const link = `${appUrl()}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=${encodeURIComponent(type)}`;
  const first = p.full_name.split(' ')[0] || 'there';
  const subject = invite ? 'Your ShiftReady login' : 'Set a new ShiftReady password';
  const intro = invite
    ? 'You’ve been given a ShiftReady login at Staff Selection UK. Use the button below to set your password, then you’ll set up an authenticator app on your phone.'
    : 'Use the button below to set a new ShiftReady password.';
  const text = [`Hi ${first},`, '', intro, '', link, '',
    `The link works once and expires in 24 hours. If it has expired, go to ${appUrl()}/login and press Forgotten password, or ask an admin to send a new one.`, '',
    'Staff Selection UK'].join('\n');
  const html = `<p>Hi ${esc(first)},</p><p>${esc(intro)}</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#5270ff;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">${invite ? 'Set my password' : 'Set a new password'}</a></p>
<p style="color:#5d6676;font-size:14px">The link works once and expires in 24 hours. If it has expired, go to <a href="${esc(appUrl())}/login">${esc(appUrl())}/login</a> and press Forgotten password, or ask an admin to send a new one.</p>
<p>Staff Selection UK</p>`;
  const r = await sendEmail({ to: email, subject, text, html, tag: invite ? 'staff-invite' : 'staff-reset', stream: clientStream() });
  if (!r.ok) return { ok: false as const, error: r.error || 'Email failed.' };
  return { ok: true as const, userId: data.user.id, dryRun: r.status === 'dry-run' };
}
