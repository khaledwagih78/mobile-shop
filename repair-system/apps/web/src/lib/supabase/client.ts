'use client';
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './env';

let client: SupabaseClient | null = null;

/** Single browser client (session kept in cookies so server components see it too). */
export function supabaseBrowser(): SupabaseClient {
  if (!client) client = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return client;
}
