// المرحلة 3: دوال شاشات المدير والاستقبال
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Cast, type Ctx, type Intake, cast, expectError, inHours, receivedAndAssigned, rpc, select, setupDb, teardownDb,
  walkIn,
} from './helpers';

let ctx: Ctx;
let p: Cast;
let a: Intake; // assigned + diagnosing
let b: Intake; // received, unassigned, overdue

beforeAll(async () => {
  ctx = await setupDb();
  p = await cast(ctx);
  a = await receivedAndAssigned(ctx, p);
  await rpc(ctx, p.tech1, 'change_repair_status', { p_order: a.repair_order_id, p_to: 'UNDER_DIAGNOSIS', p_internal_note: 'سري' });
  b = await walkIn(ctx, p, { device: { device_type: 'TABLET', brand: 'Apple', model: 'iPad 9', imei: '359999999999999' } });
  await ctx.pool.query(`update public.repair_orders set expected_ready_at = now() - interval '2 hours' where id = $1`, [b.repair_order_id]);
  await rpc(ctx, p.customer, 'customer_create_booking', {
    p: { device: { brand: 'Honor', model: 'X8' }, issue_description: 'السوفت وير', preferred_at: inHours(4) },
  });
});
afterAll(async () => teardownDb(ctx));

describe('لوحة الإحصائيات', () => {
  it('أرقام تشغيلية صحيحة بدون أي إيرادات', async () => {
    const s = await rpc(ctx, p.manager, 'staff_dashboard_stats');
    expect(s).toMatchObject({
      received_today: 2, under_diagnosis: 1, overdue: 1, unassigned: 1, in_shop: 2, pending_bookings: 1, ready: 0,
    });
    expect(JSON.stringify(s)).not.toMatch(/revenue|profit|cost|amount/);
  });

  it('للمدير والاستقبال فقط', async () => {
    expect(await rpc(ctx, p.reception, 'staff_dashboard_stats')).toBeTruthy();
    await expectError(rpc(ctx, p.tech1, 'staff_dashboard_stats'), 'FORBIDDEN');
    await expectError(rpc(ctx, p.customer, 'staff_dashboard_stats'), 'FORBIDDEN');
  });
});

describe('قائمة كل الأجهزة', () => {
  it('ترجع الفني الحالي والتأخير ومدة الجهاز في المحل', async () => {
    const rows = await select(ctx, p.manager, `select * from public.staff_list_orders()`);
    const ra = rows.find((r) => r.id === a.repair_order_id);
    const rb = rows.find((r) => r.id === b.repair_order_id);
    expect(ra).toMatchObject({ status: 'UNDER_DIAGNOSIS', status_label: 'تحت الفحص', technician_name: 'الفني أحمد', is_overdue: false });
    expect(rb).toMatchObject({ technician_name: null, is_overdue: true, device_type: 'TABLET' });
    expect(Number(rb.hours_in_shop)).toBeGreaterThanOrEqual(0);
  });

  it('فلاتر: الحالة، الفني، التأخير، نوع الجهاز، البحث برقم الطلب/IMEI/الهاتف', async () => {
    const q = (sql: string, v: unknown[] = []) => select(ctx, p.manager, sql, v);
    expect((await q(`select id from public.staff_list_orders(p_statuses => array['UNDER_DIAGNOSIS']::public.repair_status[])`)).map((r) => r.id)).toEqual([a.repair_order_id]);
    expect((await q(`select id from public.staff_list_orders(p_technician => $1)`, [p.tech1.employeeId])).map((r) => r.id)).toEqual([a.repair_order_id]);
    expect((await q(`select id from public.staff_list_orders(p_overdue_only => true)`)).map((r) => r.id)).toEqual([b.repair_order_id]);
    expect((await q(`select id from public.staff_list_orders(p_device_type => 'TABLET')`)).map((r) => r.id)).toEqual([b.repair_order_id]);
    expect((await q(`select id from public.staff_list_orders(p_unassigned_only => true)`)).map((r) => r.id)).toEqual([b.repair_order_id]);
    expect((await q(`select id from public.staff_list_orders(p_search => $1)`, [b.order_number])).map((r) => r.id)).toEqual([b.repair_order_id]);
    expect((await q(`select id from public.staff_list_orders(p_search => '9999999999')`)).map((r) => r.id)).toEqual([b.repair_order_id]);
    const byPhone = await q(`select id from public.staff_list_orders(p_search => $1)`, ['0' + p.customer.phone.slice(3)]);
    expect(byPhone.length).toBeGreaterThanOrEqual(2);
  });

  it('الفني والعميل لا يستخدمونها', async () => {
    await expectError(select(ctx, p.tech1, `select * from public.staff_list_orders()`), 'FORBIDDEN');
    await expectError(select(ctx, p.customer, `select * from public.staff_list_orders()`), 'FORBIDDEN');
  });
});

describe('تفاصيل الجهاز وسجل الحركة', () => {
  it('من استلم، الفني، سجل الحركة بالأسماء، الملاحظات الداخلية', async () => {
    const d = await rpc(ctx, p.manager, 'staff_order_details', { p_order: a.repair_order_id });
    expect(d.order.received_by).toBe('موظف الاستقبال');
    expect(d.order.current_technician_name).toBe('الفني أحمد');
    expect(d.device.has_passcode).toBe(true);
    expect(JSON.stringify(d)).not.toContain('passcode_encrypted');
    expect(d.assignments[0]).toMatchObject({ technician_name: 'الفني أحمد', assigned_by: 'مدير الفرع', is_current: true });
    expect(d.assignments[0].accepted_at).toBeTruthy();
    const events = d.timeline.map((e: { event_type: string }) => e.event_type);
    expect(events).toEqual(expect.arrayContaining(['CREATED', 'TECH_ASSIGNED', 'TECH_ACCEPTED', 'STATUS_CHANGED']));
    const diag = d.timeline.find((e: { to_status: string; event_type: string }) => e.event_type === 'STATUS_CHANGED');
    expect(diag).toMatchObject({ actor: 'الفني أحمد', actor_role: 'TECHNICIAN', internal_note: 'سري' });
  });

  it('ملاحظات داخلية وموعد انتهاء جديد (يظهر للعميل)', async () => {
    await rpc(ctx, p.reception, 'staff_set_internal_notes', { p_order: b.repair_order_id, p_notes: 'العميل مستعجل' });
    const newEta = inHours(10);
    await rpc(ctx, p.reception, 'staff_set_expected_ready', { p_order: b.repair_order_id, p_expected: newEta });
    const d = await rpc(ctx, p.manager, 'staff_order_details', { p_order: b.repair_order_id });
    expect(d.order.internal_notes).toBe('العميل مستعجل');
    expect(d.order.is_overdue).toBe(false);
    const [t] = await select(ctx, p.customer, `select expected_ready_at from public.customer_tracking where repair_order_id = $1`, [b.repair_order_id]);
    expect(new Date(t.expected_ready_at).toISOString()).toBe(new Date(newEta).toISOString());
    await expectError(rpc(ctx, p.tech1, 'staff_set_internal_notes', { p_order: a.repair_order_id, p_notes: 'x' }), 'FORBIDDEN');
  });
});

describe('الحجوزات والعملاء والفنيين', () => {
  it('قائمة الحجوزات مع البحث بالاسم/الهاتف', async () => {
    const all = await select(ctx, p.reception, `select * from public.staff_list_bookings(array['PENDING']::public.booking_status[])`);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ customer_name: 'عميل أول', brand: 'Honor' });
    expect(await select(ctx, p.reception, `select id from public.staff_list_bookings(p_search => 'لا يوجد')`)).toHaveLength(0);
  });

  it('بحث العملاء للاستلام: أجهزته وحالة حسابه', async () => {
    const rows = await select(ctx, p.reception, `select * from public.staff_search_customers($1)`, [p.customer.phone.slice(-6)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ full_name: 'عميل أول', has_account: true, account_verified: true });
    expect(rows[0].devices.length).toBeGreaterThanOrEqual(2);
    expect(await select(ctx, p.reception, `select * from public.staff_search_customers('a')`)).toHaveLength(0);
  });

  it('الفنيين مع عدد الأجهزة المفتوحة', async () => {
    const t = await select(ctx, p.manager, `select * from public.staff_list_technicians()`);
    const t1 = t.find((r) => r.employee_id === p.tech1.employeeId);
    expect(t1).toMatchObject({ full_name: 'الفني أحمد', role: 'TECHNICIAN' });
    expect(Number(t1.open_orders)).toBe(1);
  });

  it('بيانات مشاركة الإيصال للموظف فقط', async () => {
    const s = await rpc(ctx, p.reception, 'staff_receipt_share', { p_order: b.repair_order_id });
    expect(s).toMatchObject({ order_number: b.order_number, tracking_token: b.tracking_token });
    await expectError(rpc(ctx, p.customer, 'staff_receipt_share', { p_order: b.repair_order_id }), 'FORBIDDEN');
  });
});

describe('إعدادات الفرع', () => {
  it('المدير يحدّث بيانات التواصل ورابط الموقع، وتظهر في الإيصال', async () => {
    const s = await rpc(ctx, p.manager, 'get_branch_settings');
    await rpc(ctx, p.manager, 'update_branch_settings', {
      p: { ...s, phone: '0822222222', address: 'سوهاج — شارع الجمهورية', tracking_base_url: 'https://khaled-repair.example/' },
    });
    const r = await rpc(ctx, null, 'get_receipt', { p_token: b.tracking_token });
    expect(r.branch_phone).toBe('0822222222');
    expect(r.branch_address).toBe('سوهاج — شارع الجمهورية');
    expect(r.tracking_url).toBe('https://khaled-repair.example/track/' + b.tracking_token);
    await expectError(rpc(ctx, p.manager, 'update_branch_settings', { p: { ...s, tracking_base_url: 'javascript:alert(1)' } }), 'INVALID_URL');
  });

  it('الاستقبال يقرأ بس، والفني لا', async () => {
    const s = await rpc(ctx, p.reception, 'get_branch_settings');
    await expectError(rpc(ctx, p.reception, 'update_branch_settings', { p: s }), 'FORBIDDEN');
    await expectError(rpc(ctx, p.tech1, 'get_branch_settings'), 'FORBIDDEN');
  });
});
