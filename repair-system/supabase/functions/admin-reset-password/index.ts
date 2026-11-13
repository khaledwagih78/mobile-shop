// Supabase Edge Function: admin-reset-password
// الأدمن يعيّن كلمة سر جديدة لمستخدم نسي كلمة السر (لأن مفيش SMS/إيميل حقيقي).
// - بيتأكد إن المستدعي ADMIN نشط عن طريق whoami() بالـ JWT بتاعه (مش من الـ body).
// - بيستخدم service role (متاح تلقائيًا داخل Edge Functions) لتغيير كلمة السر.
// - بيسجّل العملية في audit_logs.
// النشر:  supabase functions deploy admin-reset-password
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json(401, { error: 'NOT_AUTHENTICATED' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // 1) who is calling? (role comes from the database, not from the request)
  const asCaller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: me, error: meErr } = await asCaller.rpc('whoami');
  if (meErr || !me) return json(401, { error: 'NOT_AUTHENTICATED' });
  if (me.role !== 'ADMIN' || !me.is_active) return json(403, { error: 'FORBIDDEN' });

  // 2) validate input
  let body: { profile_id?: string; new_password?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'INVALID_BODY' });
  }
  const profileId = body.profile_id ?? '';
  const password = body.new_password ?? '';
  if (!UUID.test(profileId)) return json(400, { error: 'INVALID_PROFILE' });
  if (password.length < 8 || password.length > 72) return json(400, { error: 'WEAK_PASSWORD' });

  // 3) change the password with the service role
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { error: updErr } = await admin.auth.admin.updateUserById(profileId, { password });
  if (updErr) return json(400, { error: 'RESET_FAILED' });

  await admin.from('audit_logs').insert({
    actor_id: me.id,
    actor_role: 'ADMIN',
    action: 'ADMIN_RESET_PASSWORD',
    table_name: 'profiles',
    record_id: profileId,
  });

  return json(200, { ok: true });
});
