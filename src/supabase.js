// Supabase client — publishable (anon) key is safe to expose in client-side code.
// Reads from environment variables (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY) with fallback.
import { createClient } from'@supabase/supabase-js';

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||'https://pbqxoxthlrsqwinebiar.supabase.co';
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBicXhveHRobHJzcXdpbmViaWFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQxNjIyNjgsImV4cCI6MjEwOTczODI2OH0.MeHQKHIfU02jEqondkXOsvVPOAUmWHkV-Z_DTRN5dP0';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------- cloud owner sign-in ----------
// The secured schema (supabase/schema.sql) locks every business table so only a
// signed-in user (role `authenticated`) can read/write; the public (role `anon`)
// can read ONLY the `public_catalog` view (name + sale price). For sync to work
// the app must therefore sign in as the shop's owner account first.
//
// Credentials come from the shop's .env (set once per shop; see schema.sql):
//   VITE_SUPABASE_OWNER_EMAIL / VITE_SUPABASE_OWNER_PASSWORD
//
// If no credentials are configured, sign-in is skipped and the app keeps using
// the plain anon connection — which still works against the OLD open schema, so
// shops that don't use the public storefront are unaffected.
const OWNER_EMAIL = import.meta.env.VITE_SUPABASE_OWNER_EMAIL ||'';
const OWNER_PASSWORD = import.meta.env.VITE_SUPABASE_OWNER_PASSWORD ||'';

export const cloudAuthConfigured = Boolean(OWNER_EMAIL && OWNER_PASSWORD);

let _authInFlight = null;

/**
 * Ensures the Supabase client has a signed-in owner session before syncing.
 * - No credentials configured  -> returns true (stay on anon; legacy open schema).
 * - Already has a valid session -> returns true.
 * - Otherwise signs in with the owner email/password.
 * Returns true if the connection is ready to sync, false if sign-in failed.
 */
export async function ensureCloudAuth() {
  if (!cloudAuthConfigured) return true; // nothing to do — legacy/open mode

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) return true;
  } catch { /* fall through to sign-in */ }

  // De-dupe concurrent callers (sync heartbeat can fire in parallel)
  if (_authInFlight) return _authInFlight;

  _authInFlight = (async () => {
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: OWNER_EMAIL,
        password: OWNER_PASSWORD,
      });
      if (error) {
        console.warn('[cloud-auth] sign-in failed:', error.message);
        return false;
      }
      return true;
    } catch (e) {
      console.warn('[cloud-auth] sign-in error:', e?.message || e);
      return false;
    } finally {
      _authInFlight = null;
    }
  })();

  return _authInFlight;
}
