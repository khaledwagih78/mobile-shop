// Supabase client — publishable (anon) key is safe to expose in client-side code.
// Security is enforced via Row-Level Security policies on each table.
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  'https://btdhhabcczvhmhfgocza.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0ZGhoYWJjY3p2aG1oZmdvY3phIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxOTc5MjksImV4cCI6MjA5NTc3MzkyOX0.7XBh3bjZhkBp0Th3fzu3RYIKxVxHDqxDbO9L2h7LQo8'
);
