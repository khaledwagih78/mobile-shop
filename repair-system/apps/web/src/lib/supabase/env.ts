// القيم دي عامة (anon key) وآمنة في المتصفح — الحماية الفعلية بـ RLS في قاعدة البيانات.
// لا تضع SUPABASE_SERVICE_ROLE_KEY هنا أبداً.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? '';

export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
