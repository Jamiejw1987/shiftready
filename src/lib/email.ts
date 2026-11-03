import 'server-only';

/**
 * Email through Postmark (transactional stream only).
 * Needs POSTMARK_SERVER_TOKEN. EMAIL_FROM is optional (defaults to noreply@staffselectionuk.com).
 * Without a token it runs in "dry-run" mode: nothing is sent, and the result says so.
 *
 * Only send to people who have contacted us (applicants, registered temps). Never cold lists:
 * Postmark will suspend the account.
 */
export function emailConfigured(): boolean {
  return Boolean(process.env.POSTMARK_SERVER_TOKEN);
}

/**
 * Client portal emails (sign-in links, shift filled) and office alerts go through their own Postmark message
 * stream, kept apart from candidate emails. Set POSTMARK_CLIENT_STREAM to the stream's ID (e.g. "clients").
 * Until it's set they use the default transactional stream.
 */
export const clientStream = () => process.env.POSTMARK_CLIENT_STREAM || 'outbound';

export async function sendEmail(m: { to: string; subject: string; text: string; html?: string; tag?: string; stream?: string }) {
  if (!emailConfigured()) return { ok: true, status: 'dry-run', error: null as string | null };
  try {
    const res = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': process.env.POSTMARK_SERVER_TOKEN!,
      },
      body: JSON.stringify({
        From: process.env.EMAIL_FROM || 'Staff Selection UK <noreply@staffselectionuk.com>',
        To: m.to,
        Subject: m.subject,
        TextBody: m.text,
        HtmlBody: m.html,
        Tag: m.tag,
        MessageStream: m.stream || 'outbound',
      }),
      cache: 'no-store',
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.ErrorCode === 0) return { ok: true, status: 'sent', error: null };
    return { ok: false, status: 'failed', error: json.Message || `Postmark error ${res.status}` };
  } catch (e) {
    return { ok: false, status: 'failed', error: e instanceof Error ? e.message : 'Network error' };
  }
}

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The email applicants get when we couldn't find a UK mobile to text them. */
export function applyEmail(v: { first: string; job: string; link: string }) {
  const first = v.first || 'there';
  const job = v.job || 'one of our jobs';
  const subject = `Your application for ${job} - next step`;
  const text = [
    `Hi ${first},`,
    '',
    `Thanks for applying for ${job} with Staff Selection UK.`,
    '',
    `To be considered, please register with us here (it takes about 10 minutes):`,
    v.link,
    '',
    'Have your share code or passport ready.',
    '',
    'Kind regards,',
    'Staff Selection UK',
  ].join('\n');
  const html = `<p>Hi ${esc(first)},</p>
<p>Thanks for applying for <b>${esc(job)}</b> with Staff Selection UK.</p>
<p>To be considered, please register with us. It takes about 10 minutes.</p>
<p><a href="${esc(v.link)}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold">Register now</a></p>
<p>Have your share code or passport ready.</p>
<p>Kind regards,<br>Staff Selection UK</p>`;
  return { subject, text, html };
}
