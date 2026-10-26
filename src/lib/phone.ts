/** UK mobile helpers. Stored as E.164 (+447...), shown as 07xxx xxxxxx. */

export function toE164(input: string): string | null {
  let s = (input || '').replace(/[\s().-]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (s.startsWith('+44')) s = '0' + s.slice(3);
  else if (s.startsWith('44') && s.length === 12) s = '0' + s.slice(2);
  else if (/^7\d{9}$/.test(s)) s = '0' + s; // Excel drops the leading 0
  if (!/^07\d{9}$/.test(s)) return null;
  return '+44' + s.slice(1);
}

export function displayMobile(e164: string): string {
  if (!e164?.startsWith('+44')) return e164 || '';
  const local = '0' + e164.slice(3);
  return local.slice(0, 5) + ' ' + local.slice(5);
}
