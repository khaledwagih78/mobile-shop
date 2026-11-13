import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { AppRole } from '@kmr/shared';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './env';

export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // called from a Server Component: the middleware refreshes cookies instead
        }
      },
    },
  });
}

export interface WhoAmI {
  id: string;
  role: AppRole;
  full_name: string | null;
  phone: string | null;
  branch_id: string | null;
  is_active: boolean;
  employee_id: string | null;
  customer: { id: string; full_name: string; phone: string; verified: boolean } | null;
}

/** Current user from the database (role comes from profiles, never from the client). */
export async function getWhoAmI(): Promise<WhoAmI | null> {
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await sb.rpc('whoami');
  if (error || !data) return null;
  return data as WhoAmI;
}
