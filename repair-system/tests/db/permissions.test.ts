// اختبارات الأمان والصلاحيات (RLS + RPC checks + immutability)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Cast, type Ctx, type Intake, as, cast, expectError, orderStatus, receivedAndAssigned, rpc, select,
  setupDb, teardownDb, toQuote, walkIn,
} from './helpers';

let ctx: Ctx;
let p: Cast;
let order: Intake;

beforeAll(async () => {
  ctx = await setupDb();
  p = await cast(ctx);
  order = await receivedAndAssigned(ctx, p);
  await rpc(ctx, p.tech1, 'change_repair_status', {
    p_order: order.repair_order_id, p_to: 'UNDER_DIAGNOSIS', p_internal_note: 'ملاحظة داخلية سرية',
  });
});
afterAll(async () => teardownDb(ctx));

describe('صلاحيات العميل', () => {
  it('لا يقرأ جداول التشغيل الداخلية مباشرة', async () => {
    for (const t of ['repair_orders', 'repair_status_history', 'technician_assignments', 'diagnostics', 'employees', 'customers', 'audit_logs', 'repair_parts', 'notification_logs', 'handover_records']) {
      const rows = await select(ctx, p.customer, `select * from public.${t}`);
      expect(rows, t).toHaveLength(0);
    }
  });

  it('يرى جهازه فقط في التتبع، ولا يرى بيانات عميل آخر', async () => {
    const mine = await select(ctx, p.customer, `select repair_order_id from public.customer_tracking`);
    expect(mine.map((r) => r.repair_order_id)).toContain(order.repair_order_id);
    expect(await select(ctx, p.other, `select * from public.customer_tracking where repair_order_id = $1`, [order.repair_order_id])).toHaveLength(0);
    expect(await select(ctx, p.other, `select id, brand, model from public.devices where id = $1`, [order.device_id])).toHaveLength(0);
    await expectError(rpc(ctx, p.other, 'customer_order_timeline', { p_order: order.repair_order_id }), 'ORDER_NOT_FOUND');
  });

  it('لا يرى أسماء الفنيين أو الملاحظات الداخلية في أي مكان متاح له', async () => {
    const tracking = await select(ctx, p.customer, `select * from public.customer_tracking where repair_order_id = $1`, [order.repair_order_id]);
    const timeline = await select(ctx, p.customer, `select * from public.customer_order_timeline($1)`, [order.repair_order_id]);
    const profiles = await select(ctx, p.customer, `select * from public.profiles`);
    const pub = await rpc(ctx, null, 'track_order', { p_token: order.tracking_token });
    const blob = JSON.stringify({ tracking, timeline, profiles, pub });
    expect(blob).not.toContain('الفني أحمد');
    expect(blob).not.toContain('ملاحظة داخلية سرية');
    expect(blob).not.toContain(p.tech1.employeeId!);
    expect(blob).not.toContain(p.tech1.id);
    expect(profiles).toHaveLength(1); // نفسه فقط
    expect(Object.keys(tracking[0])).not.toContain('current_technician_id');
    expect(timeline.length).toBeGreaterThan(0);
  });

  it('لا يمكنه الكتابة المباشرة على أي جدول', async () => {
    await expectError(as(ctx, p.customer, (c) => c.query(`update public.repair_orders set status = 'READY_FOR_PICKUP'`)), 'permission denied');
    await expectError(as(ctx, p.customer, (c) => c.query(`update public.customer_tracking set status = 'READY_FOR_PICKUP'`)), 'permission denied');
    await expectError(as(ctx, p.customer, (c) => c.query(`insert into public.customer_reviews (repair_order_id, customer_id, rating) values ($1, $2, 5)`, [order.repair_order_id, p.customer.customerId])), 'permission denied');
    await expectError(as(ctx, p.customer, (c) => c.query(`update public.profiles set role = 'ADMIN' where id = auth.uid()`)), 'permission denied');
  });

  it('لا يستطيع تنفيذ عمليات الموظفين', async () => {
    await expectError(rpc(ctx, p.customer, 'assign_technician', { p_order: order.repair_order_id, p_technician: p.tech2.employeeId }), 'FORBIDDEN');
    await expectError(rpc(ctx, p.customer, 'approve_completion', { p_order: order.repair_order_id }), 'FORBIDDEN');
    await expectError(rpc(ctx, p.customer, 'change_repair_status', { p_order: order.repair_order_id, p_to: 'UNDER_REPAIR' }), 'INVALID_TRANSITION');
    await expectError(rpc(ctx, p.customer, 'reveal_device_passcode', { p_order: order.repair_order_id }), 'FORBIDDEN');
    await expectError(rpc(ctx, p.customer, 'admin_set_role', { p_profile: p.customer.id, p_role: 'ADMIN' }), 'FORBIDDEN');
  });

  it('لا يرد على عرض سعر خاص بعميل آخر', async () => {
    const { quote } = await toQuote(ctx, p);
    await expectError(rpc(ctx, p.other, 'customer_respond_quote', { p_approval: quote.approval_id, p_approve: true }), 'APPROVAL_NOT_FOUND');
  });
});

describe('صلاحيات الفني', () => {
  it('يرى الأجهزة المسندة إليه فقط', async () => {
    const other = await walkIn(ctx, p);
    const t1 = await select(ctx, p.tech1, `select id from public.repair_orders`);
    expect(t1.map((r) => r.id)).toContain(order.repair_order_id);
    expect(t1.map((r) => r.id)).not.toContain(other.repair_order_id);
    expect(await select(ctx, p.tech2, `select id from public.repair_orders where id = $1`, [order.repair_order_id])).toHaveLength(0);
  });

  it('لا يرى بيانات العملاء (الاسم/الهاتف)', async () => {
    expect(await select(ctx, p.tech1, `select * from public.customers`)).toHaveLength(0);
    const profs = await select(ctx, p.tech1, `select role from public.profiles`);
    expect(profs.every((r) => r.role !== 'CUSTOMER')).toBe(true);
  });

  it('لا يعدّل طلبات غير مسندة إليه', async () => {
    const other = await receivedAndAssigned(ctx, p, p.tech2);
    await expectError(rpc(ctx, p.tech1, 'change_repair_status', { p_order: other.repair_order_id, p_to: 'UNDER_DIAGNOSIS' }), 'FORBIDDEN_TRANSITION');
    await expectError(rpc(ctx, p.tech1, 'tech_accept_assignment', { p_order: other.repair_order_id }), 'FORBIDDEN');
    await expectError(rpc(ctx, p.tech1, 'add_repair_part', { p_order: other.repair_order_id, p_part_name: 'x' }), 'FORBIDDEN');
    await expectError(rpc(ctx, p.tech1, 'tech_submit_diagnosis', { p_order: other.repair_order_id, p_findings: 'xxxx', p_proposed_solution: 'yyyy' }), 'FORBIDDEN');
  });

  it('لا يحدد السعر ولا يعيّن فنيين ولا يسلّم', async () => {
    await expectError(rpc(ctx, p.tech1, 'send_quote', { p_order: order.repair_order_id, p_amount: 1, p_customer_details: 'xxxx' }), 'FORBIDDEN');
    await expectError(rpc(ctx, p.tech1, 'assign_technician', { p_order: order.repair_order_id, p_technician: p.tech2.employeeId }), 'FORBIDDEN');
    await expectError(rpc(ctx, p.tech1, 'deliver_device', { p_order: order.repair_order_id, p_received_by_name: 'x', p_verification_method: 'xx' }), 'FORBIDDEN');
  });
});

describe('صلاحيات الاستقبال والمدير', () => {
  it('الاستقبال لا يعيّن فنيين ولا يعتمد ولا يسلّم', async () => {
    await expectError(rpc(ctx, p.reception, 'assign_technician', { p_order: order.repair_order_id, p_technician: p.tech2.employeeId }), 'FORBIDDEN');
    await expectError(rpc(ctx, p.reception, 'approve_completion', { p_order: order.repair_order_id }), 'FORBIDDEN');
    await expectError(rpc(ctx, p.reception, 'send_quote', { p_order: order.repair_order_id, p_amount: 1, p_customer_details: 'xxxx' }), 'FORBIDDEN');
  });

  it('المدير لا يقوم بخطوات الفني إلا لو كان هو المسند', async () => {
    await expectError(rpc(ctx, p.manager, 'tech_submit_diagnosis', { p_order: order.repair_order_id, p_findings: 'xxxx', p_proposed_solution: 'yyyy' }), 'FORBIDDEN');
  });

  it('سجل التدقيق للمدير/الأدمن فقط', async () => {
    expect((await select(ctx, p.manager, `select id from public.audit_logs limit 5`)).length).toBeGreaterThan(0);
    expect(await select(ctx, p.reception, `select id from public.audit_logs`)).toHaveLength(0);
    expect(await select(ctx, p.tech1, `select id from public.audit_logs`)).toHaveLength(0);
  });

  it('سجل التدقيق لا يحتوي رمز القفل أو رموز الروابط', async () => {
    const r = await ctx.pool.query(`select new_data::text as t from public.audit_logs where table_name in ('devices','repair_orders','customer_approvals')`);
    for (const row of r.rows) {
      expect(row.t).not.toContain('passcode_encrypted');
      expect(row.t).not.toContain('tracking_token');
      expect(row.t).not.toContain('token_hash');
    }
  });

  it('الأدمن فقط يغيّر الأدوار', async () => {
    await expectError(rpc(ctx, p.manager, 'admin_set_role', { p_profile: p.other.id, p_role: 'TECHNICIAN' }), 'FORBIDDEN');
    await expectError(rpc(ctx, p.admin, 'admin_set_role', { p_profile: p.admin.id, p_role: 'MANAGER' }), 'CANNOT_DEMOTE_SELF');
  });
});

describe('المجهول (رابط المتابعة / QR)', () => {
  it('يرى حالة الجهاز فقط بالرمز الصحيح، ولا يقرأ أي جدول', async () => {
    const t = await rpc(ctx, null, 'track_order', { p_token: order.tracking_token });
    expect(t.status).toBe('UNDER_DIAGNOSIS');
    expect(t.status_label).toBe('تحت الفحص');
    expect(await rpc(ctx, null, 'track_order', { p_token: 'x'.repeat(36) })).toBeNull();
    await expectError(select(ctx, null, `select * from public.customer_tracking`), 'permission denied');
    await expectError(select(ctx, null, `select * from public.repair_orders`), 'permission denied');
    await expectError(rpc(ctx, null, 'change_repair_status', { p_order: order.repair_order_id, p_to: 'UNDER_REPAIR' }), 'permission denied');
  });
});

describe('سلامة السجلات', () => {
  it('سجل الحركة لا يُعدّل ولا يُحذف حتى من service role', async () => {
    await expectError(ctx.pool.query(`update public.repair_status_history set public_note = 'x'`), 'IMMUTABLE_RECORD');
    await expectError(ctx.pool.query(`delete from public.repair_status_history`), 'IMMUTABLE_RECORD');
    await expectError(ctx.pool.query(`truncate public.repair_status_history cascade`), 'IMMUTABLE_RECORD');
  });

  it('سجل الموافقات وسجل التدقيق لا يُحذفان، والموافقة المنتهية لا تتغير', async () => {
    const { quote } = await toQuote(ctx, p);
    await expectError(ctx.pool.query(`delete from public.customer_approvals where id = $1`, [quote.approval_id]), 'IMMUTABLE_RECORD');
    await expectError(ctx.pool.query(`update public.customer_approvals set amount = 1 where id = $1`, [quote.approval_id]), 'APPROVAL_TERMS_IMMUTABLE');
    await rpc(ctx, p.customer, 'customer_respond_quote', { p_approval: quote.approval_id, p_approve: true });
    await expectError(ctx.pool.query(`update public.customer_approvals set status = 'REJECTED' where id = $1`, [quote.approval_id]), 'APPROVAL_FINALIZED');
    await expectError(ctx.pool.query(`delete from public.audit_logs`), 'IMMUTABLE_RECORD');
    await expectError(ctx.pool.query(`delete from public.technician_assignments`), 'IMMUTABLE_RECORD');
  });

  it('أي انتقال غير قانوني مرفوض على مستوى قاعدة البيانات حتى بدون RPC', async () => {
    await expectError(ctx.pool.query(`update public.repair_orders set status = 'DELIVERED' where id = $1`, [order.repair_order_id]), 'INVALID_TRANSITION');
    await expectError(ctx.pool.query(`update public.repair_orders set order_number = 'KMR-2026-999999' where id = $1`, [order.repair_order_id]), 'ORDER_NUMBER_IMMUTABLE');
    expect(await orderStatus(ctx, order.repair_order_id)).toBe('UNDER_DIAGNOSIS');
  });

  it('الانتقالات الحساسة لا تتم إلا من الـ RPC المخصص لها', async () => {
    await expectError(rpc(ctx, p.manager, 'change_repair_status', { p_order: order.repair_order_id, p_to: 'WAITING_CUSTOMER_APPROVAL' }), 'TRANSITION_REQUIRES_RPC');
  });

  it('رمز القفل لا يُقرأ من جدول الأجهزة', async () => {
    await expectError(select(ctx, p.manager, `select passcode_encrypted from public.devices`), 'permission denied');
  });
});

describe('حماية الـ API', () => {
  it('المجهول لا يستدعي إلا دوال التتبع/الإيصال/رابط الموافقة', async () => {
    const r = await ctx.pool.query(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') order by 1`);
    expect(r.rows.map((x) => x.proname)).toEqual(
      ['get_quote_by_token', 'get_receipt', 'repair_status_label', 'respond_quote_by_token', 'track_order']);
  });

  it('لا توجد دالة داخلية (private) متاحة للعملاء', async () => {
    const r = await ctx.pool.query(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private' and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))`);
    const usage = await ctx.pool.query(`select has_schema_privilege('authenticated', 'private', 'usage') as u`);
    expect(r.rows.length === 0 || usage.rows[0].u === false).toBe(true);
  });

  it('كل الجداول عليها RLS مفعّل', async () => {
    const r = await ctx.pool.query(`select tablename from pg_tables where schemaname = 'public' and not rowsecurity`);
    expect(r.rows).toHaveLength(0);
  });
});
