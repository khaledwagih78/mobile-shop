// المرحلة 2: الحسابات بدون OTP — الربط الآمن بين حساب التطبيق وبيانات المحل.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Cast, type Ctx, cast, createStaff, expectError, rpc, select, setupDb, signUp, teardownDb,
} from './helpers';

let ctx: Ctx;
let p: Cast;

beforeAll(async () => {
  ctx = await setupDb();
  p = await cast(ctx);
});
afterAll(async () => teardownDb(ctx));

/** نفس طريقة تطبيق الويب: إيميل داخلي مشتق من الرقم + الرقم في الـ metadata. */
async function signUpLikeApp(name: string, phone: string) {
  const digits = phone.replace(/[^0-9]/g, '');
  const r = await ctx.pool.query(
    `insert into auth.users (email, raw_user_meta_data) values ($1, jsonb_build_object('full_name', $2::text, 'phone', $3::text)) returning id`,
    [`${digits}@phone.kmr.invalid`, name, phone],
  );
  const id = r.rows[0].id as string;
  const c = await ctx.pool.query(`select id from public.customers where profile_id = $1`, [id]);
  return { id, phone, role: 'CUSTOMER' as const, customerId: c.rows[0]?.id as string | undefined };
}

async function walkInFor(phone: string, name: string, extra: Record<string, unknown> = {}) {
  return rpc(ctx, p.reception, 'receive_device', {
    p: { customer: { phone, full_name: name, ...extra }, device: { brand: 'Nokia', model: 'G21' }, issue_description: 'الشحن مش شغال' },
  });
}

describe('التسجيل برقم الموبايل + كلمة سر', () => {
  it('رقم جديد: profile + سجل عميل غير موثّق', async () => {
    const u = await signUpLikeApp('منى', '01055554444');
    const who = await rpc(ctx, u, 'whoami');
    expect(who.role).toBe('CUSTOMER');
    expect(who.phone).toBe('+201055554444');
    expect(who.customer.verified).toBe(false);
  });

  it('لا يمكن عمل حسابين بنفس الرقم', async () => {
    await signUpLikeApp('أ', '01033332222');
    await expectError(ctx.pool.query(
      `insert into auth.users (email, raw_user_meta_data) values ('x@phone.kmr.invalid', '{"phone":"+201033332222"}')`), 'profiles_phone_uidx');
  });
});

describe('لا ربط تلقائي ببيانات المحل (الرقم غير موثّق)', () => {
  it('حساب جديد برقم عميل موجود في المحل لا يرى أجهزته', async () => {
    const rec = await walkInFor('01077778888', 'كريم');
    const intruder = await signUpLikeApp('منتحل', '01077778888');
    expect(intruder.customerId).toBeUndefined();
    expect(await select(ctx, intruder, `select * from public.customer_tracking`)).toHaveLength(0);
    expect(await rpc(ctx, intruder, 'my_customer')).toBeNull();
    // بدون رمز الإيصال لا يقدر يربط
    await expectError(rpc(ctx, intruder, 'claim_customer_record', { p_tracking_token: 'x'.repeat(36) }), 'CLAIM_NOT_FOUND');
    expect(rec.repair_order_id).toBeTruthy();
  });

  it('صاحب الرقم الحقيقي يربط حسابه برابط الإيصال', async () => {
    const rec = await walkInFor('01066665555', 'ياسر');
    const owner = await signUpLikeApp('ياسر', '01066665555');
    const me = await rpc(ctx, owner, 'claim_customer_record', { p_tracking_token: rec.tracking_token });
    expect(me.verified).toBe(true);
    const t = await select(ctx, owner, `select repair_order_id from public.customer_tracking`);
    expect(t.map((r) => r.repair_order_id)).toContain(rec.repair_order_id);
    await expectError(rpc(ctx, owner, 'claim_customer_record', { p_tracking_token: rec.tracking_token }), 'ALREADY_LINKED');
  });

  it('رابط إيصال لرقم مختلف مرفوض', async () => {
    const rec = await walkInFor('01011112222', 'سامي');
    await walkInFor('01044443333', 'سجل محل');
    const noRecord = await signUpLikeApp('بدون سجل', '01044443333'); // رقم موجود في المحل ← بدون سجل مربوط
    expect(noRecord.customerId).toBeUndefined();
    await expectError(rpc(ctx, noRecord, 'claim_customer_record', { p_tracking_token: rec.tracking_token }), 'CLAIM_PHONE_MISMATCH');
  });

  it('حساب برقم جديد ثم استلام جهاز بنفس الرقم: الموظف لازم يقرر (توثيق/فصل)', async () => {
    const squatter = await signUpLikeApp('حساب مجهول', '01088887777');
    await expectError(walkInFor('01088887777', 'صاحب الرقم'), 'UNVERIFIED_ACCOUNT_DECISION_REQUIRED');

    // الشخص اللي قدام الموظف مش صاحب الحساب ← فصل
    const rec = await walkInFor('01088887777', 'صاحب الرقم', { account_action: 'detach' });
    expect(await select(ctx, squatter, `select * from public.customer_tracking`)).toHaveLength(0);
    expect(await rpc(ctx, squatter, 'my_customer')).toBeNull();
    const audit = await ctx.pool.query(`select count(*)::int as n from public.audit_logs where action = 'DETACH_CUSTOMER_ACCOUNT'`);
    expect(audit.rows[0].n).toBe(1);
    expect(rec.order_number).toMatch(/^KMR-/);
  });

  it('توثيق الحساب وجهًا لوجه يربطه بالأجهزة', async () => {
    const u = await signUpLikeApp('هالة', '01022221111');
    const rec = await walkInFor('01022221111', 'هالة', { account_action: 'verify' });
    expect((await rpc(ctx, u, 'my_customer')).verified).toBe(true);
    const t = await select(ctx, u, `select repair_order_id from public.customer_tracking`);
    expect(t.map((r) => r.repair_order_id)).toContain(rec.repair_order_id);
    // بعد التوثيق مفيش سؤال تاني
    await walkInFor('01022221111', 'هالة');
  });

  it('استلام حجز من التطبيق يوثّق الحساب تلقائيًا (الشخص حاضر بالجهاز)', async () => {
    const u = await signUpLikeApp('عمر', '01012121212');
    const b = await rpc(ctx, u, 'customer_create_booking', {
      p: { device: { brand: 'Vivo', model: 'Y20' }, issue_description: 'الكاميرا', preferred_at: new Date(Date.now() + 3600e3).toISOString() },
    });
    await rpc(ctx, p.reception, 'receive_device', { p: { booking_id: b.booking_id } });
    expect((await rpc(ctx, u, 'my_customer')).verified).toBe(true);
  });
});

describe('إدارة المستخدمين', () => {
  it('الأدمن يبحث بالرقم ويرقّي حساب لفني ثم يوقفه', async () => {
    const u = await signUpLikeApp('فني جديد', '01031313131');
    const rows = await select(ctx, p.admin, `select * from public.admin_list_users($1)`, ['01031313131']);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(u.id);

    await rpc(ctx, p.admin, 'admin_set_role', { p_profile: u.id, p_role: 'TECHNICIAN', p_job_title: 'فني سوفت وير' });
    const who = await rpc(ctx, u, 'whoami');
    expect(who.role).toBe('TECHNICIAN');
    expect(who.employee_id).toBeTruthy();

    await rpc(ctx, p.admin, 'admin_set_active', { p_profile: u.id, p_active: false });
    // الحساب الموقوف ميقدرش يعمل أي حاجة
    await expectError(rpc(ctx, u, 'tech_accept_assignment', { p_order: '00000000-0000-0000-0000-000000000000' }), 'FORBIDDEN');
    expect(await select(ctx, u, `select id from public.repair_orders`)).toHaveLength(0);
  });

  it('غير الأدمن لا يرى قائمة المستخدمين', async () => {
    await expectError(select(ctx, p.manager, `select * from public.admin_list_users()`), 'FORBIDDEN');
    await expectError(select(ctx, p.customer, `select * from public.admin_list_users()`), 'FORBIDDEN');
  });

  it('whoami للموظف يرجع الدور والفرع بدون بيانات عميل', async () => {
    const r = await createStaff(ctx, 'RECEPTIONIST', 'استقبال 2', p.admin);
    const who = await rpc(ctx, r, 'whoami');
    expect(who).toMatchObject({ role: 'RECEPTIONIST', branch_id: ctx.branchId, customer: null });
  });
});

describe('الدخول بالإيميل + كود (الطريقة التانية)', () => {
  async function signUpEmail(name: string, email: string, phone: string) {
    const r = await ctx.pool.query(
      `insert into auth.users (email, raw_user_meta_data) values ($1, jsonb_build_object('full_name', $2::text, 'phone', $3::text)) returning id`,
      [email, name, phone],
    );
    return { id: r.rows[0].id as string, phone, role: 'CUSTOMER' as const };
  }

  it('حساب بالإيميل: profile + رقم الموبايل + سجل عميل', async () => {
    const u = await signUpEmail('نادية', 'nadia@example.com', '01250505050');
    const who = await rpc(ctx, u, 'whoami');
    expect(who).toMatchObject({ role: 'CUSTOMER', phone: '+201250505050', login_method: 'EMAIL', email: 'nadia@example.com' });
    expect(who.customer.verified).toBe(false);
  });

  it('حساب الموبايل لا يكشف الإيميل الداخلي', async () => {
    const u = await signUpLikeApp('رامي', '01151515151');
    const who = await rpc(ctx, u, 'whoami');
    expect(who.login_method).toBe('PHONE');
    expect(who.email).toBeNull();
  });

  it('نفس الرقم لا يتسجل مرتين حتى بطريقتين مختلفتين', async () => {
    await signUpLikeApp('أول', '01161616161');
    await expectError(signUpEmail('تاني', 'second@example.com', '01161616161'), 'profiles_phone_uidx');
  });

  it('الإيميل لا يثبت ملكية الرقم: لا ربط تلقائي بأجهزة المحل', async () => {
    await walkInFor('01171717171', 'صاحب الرقم');
    const u = await signUpEmail('حد تاني', 'other@example.com', '01171717171');
    expect(await rpc(ctx, u, 'my_customer')).toBeNull();
    expect(await select(ctx, u, `select * from public.customer_tracking`)).toHaveLength(0);
  });

  it('الأدمن يبحث بالإيميل ويشوف طريقة الدخول', async () => {
    await signUpEmail('فني بالإيميل', 'tech.mail@example.com', '01181818181');
    const rows = await select(ctx, p.admin, `select email, login_method from public.admin_list_users($1)`, ['tech.mail@']);
    expect(rows).toEqual([{ email: 'tech.mail@example.com', login_method: 'EMAIL' }]);
    const phoneRows = await select(ctx, p.admin, `select email, login_method from public.admin_list_users($1)`, ['01151515151']);
    expect(phoneRows).toEqual([{ email: null, login_method: 'PHONE' }]);
  });
});
