import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

/**
 * Invite and password-reset emails link here (see SETUP.md, "Email templates").
 * Verifies the one-time link, signs the person in, then sends them to set a password.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const code = url.searchParams.get('code');
  const supabase = createClient();

  let ok = false;
  if (tokenHash && type) ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error;
  else if (code) ok = !(await supabase.auth.exchangeCodeForSession(code)).error;

  const dest = url.clone();
  dest.search = '';
  dest.pathname = ok ? '/auth/set-password' : '/login';
  if (!ok) dest.searchParams.set('error', 'link');
  return NextResponse.redirect(dest);
}
