// Supabase client — publishable (anon) key is safe to expose in client-side code.
// Security is enforced via Row-Level Security policies on each table.
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  'https://btdhhabcczvhmhfgocza.supabase.co',
  'sb_publishable_yucmH3eILUuKJeosmC8c3A_jTWiOII3'
);
