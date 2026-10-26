import 'server-only';
import { createClient } from '@supabase/supabase-js';

/**
 * Service-role client. Bypasses row level security, so only use it on the server for:
 * temps' private links (opt-in and offer pages), incoming texts, the reminder job,
 * and admin-only user management. Never import this into a client component.
 */
export function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
    // Never let Next.js cache database reads: temps' links must always show the latest status.
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  });
}
