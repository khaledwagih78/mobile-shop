// سيناريوهات رحلة الجهاز كاملة على قاعدة بيانات حقيقية (RLS + triggers + RPCs).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Cast, type Ctx, cast, expectError, inHours, orderStatus, receivedAndAssigned, rpc, select,
  setupDb, signUp, teardownDb, toQuote, walkIn,
} from './helpers';

let ctx: Ctx;
let p: Cast;

beforeAll(async () => {
  ctx = await setupDb();
  p = await cast(ctx);
});
afterAll(async () => teardownDb(ctx));

describe('تسجيل العميل', () => {
  it('ينشئ profile بدور CUSTOMER وسجل عميل مربوط بالهاتف', async () => {
    const u = await signUp(ctx, 'سارة', '+201112223334');
    const prof = await select(ctx, u, `select role, phone from public.profiles where id = auth.uid()`);
    expect(prof[0]).toEqual({ role: 'CUSTOMER', phone: '+201112223334' });
    const me = await rpc(ctx, u, 'my_customer');
    expect(me.full_name).toBe('سارة');
    expect(me.phone).toBe('+201112223334');
  });

});

describe('الحجز', () => {
  it('العميل يحجز ← يظهر للمدير ← تأكيد ← استلام بنفس الطلب', async () => {
    const b = await rpc(ctx, p.customer, 'customer_create_booking', {
      p: {
        device: { device_type: 'PHONE', brand: 'Apple', model: 'iPhone 13', color: 'أزرق' },
        issue_description: 'البطارية بتفصل بسرعة',
        preferred_at: inHours(24),
        idempotency_key: 'bk-1',
      },
    });
    expect(await orderStatus(ctx, b.repair_order_id)).toBe('NEW_REQUEST');

    // تكرار نفس الطلب (ضغطتين/انقطاع نت) لا ينشئ حجز ثاني
    const again = await rpc(ctx, p.customer, 'customer_create_booking', {
      p: { device: { brand: 'Apple', model: 'iPhone 13' }, issue_description: 'البطارية بتفصل بسرعة', preferred_at: inHours(24), idempotency_key: 'bk-1' },
    });
    expect(again.booking_id).toBe(b.booking_id);
    expect(again.replayed).toBe(true);

    const mgrList = await select(ctx, p.manager, `select id from public.bookings where status = 'PENDING'`);
    expect(mgrList.map((r) => r.id)).toContain(b.booking_id);

    // إشعار للمدير بحجز جديد
    const n = await select(ctx, p.manager, `select event_key from public.notifications where recipient_profile_id = auth.uid() and repair_order_id = $1`, [b.repair_order_id]);
    expect(n.map((x) => x.event_key)).toContain('NEW_BOOKING');

    await rpc(ctx, p.reception, 'confirm_booking', { p_booking: b.booking_id, p_confirmed_at: inHours(26) });
    expect(await orderStatus(ctx, b.repair_order_id)).toBe('BOOKING_CONFIRMED');

    const rec = await rpc(ctx, p.reception, 'receive_device', {
      p: { booking_id: b.booking_id, device: { imei: '351234567890123' }, intake_condition: 'سليم', idempotency_key: 'rcv-bk-1' },
    });
    expect(rec.repair_order_id).toBe(b.repair_order_id);
    expect(rec.order_number).toMatch(/^KMR-\d{4}-\d{6}$/);
    expect(await orderStatus(ctx, b.repair_order_id)).toBe('DEVICE_RECEIVED');
    const bk = await ctx.pool.query(`select status from public.bookings where id = $1`, [b.booking_id]);
    expect(bk.rows[0].status).toBe('CHECKED_IN');
  });

  it('رفض الحجز يتطلب سبب ويُلغي الطلب', async () => {
    const b = await rpc(ctx, p.customer, 'customer_create_booking', {
      p: { device: { brand: 'Xiaomi', model: 'Note 10' }, issue_description: 'مش بيشحن', preferred_at: inHours(5) },
    });
    await expectError(rpc(ctx, p.reception, 'reject_booking', { p_booking: b.booking_id, p_reason: '' }), 'REASON_REQUIRED');
    await rpc(ctx, p.reception, 'reject_booking', { p_booking: b.booking_id, p_reason: 'الموديل ده مش بنصلحه' });
    expect(await orderStatus(ctx, b.repair_order_id)).toBe('CANCELLED');
  });

  it('المحل يقترح موعد والعميل يوافق', async () => {
    const b = await rpc(ctx, p.customer, 'customer_create_booking', {
      p: { device: { brand: 'Oppo', model: 'Reno 8' }, issue_description: 'السماعة ضعيفة', preferred_at: inHours(3) },
    });
    await rpc(ctx, p.reception, 'propose_booking_time', { p_booking: b.booking_id, p_proposed_at: inHours(30) });
    await expectError(
      rpc(ctx, p.other, 'customer_respond_reschedule', { p_booking: b.booking_id, p_accept: true }),
      'BOOKING_NOT_FOUND',
    );
    await rpc(ctx, p.customer, 'customer_respond_reschedule', { p_booking: b.booking_id, p_accept: true });
    expect(await orderStatus(ctx, b.repair_order_id)).toBe('BOOKING_CONFIRMED');
  });

  it('العميل يلغي حجزه', async () => {
    const b = await rpc(ctx, p.customer, 'customer_create_booking', {
      p: { device: { brand: 'Realme', model: 'C55' }, issue_description: 'زرار الباور', preferred_at: inHours(2) },
    });
    await expectError(rpc(ctx, p.other, 'cancel_booking', { p_booking: b.booking_id }), 'FORBIDDEN_TRANSITION');
    await rpc(ctx, p.customer, 'cancel_booking', { p_booking: b.booking_id, p_reason: 'اتصلحت' });
    expect(await orderStatus(ctx, b.repair_order_id)).toBe('CANCELLED');
  });
});

describe('الاستلام والإيصال الإلكتروني', () => {
  it('walk-in لعميل جديد: رقم طلب فريد + QR token + إيصال آمن', async () => {
    const rec = await rpc(ctx, p.reception, 'receive_device', {
      p: {
        customer: { phone: '01234567890', full_name: 'محمد علي' },
        device: { brand: 'Samsung', model: 'S21', imei: '356789012345670' },
        issue_description: 'مية دخلت الجهاز',
        intake_condition: 'الجهاز مقفول',
        passcode: '739182',
      },
    });
    expect(rec.order_number).toMatch(/^KMR-\d{4}-\d{6}$/);
    expect(rec.tracking_token).toHaveLength(36);

    const receipt = await rpc(ctx, null, 'get_receipt', { p_token: rec.tracking_token });
    expect(receipt.order_number).toBe(rec.order_number);
    expect(receipt.customer_name).toBe('محمد علي');
    expect(receipt.customer_phone).not.toContain('34567'); // masked
    expect(receipt.imei).toBe('***********5670');
    expect(receipt.receipt_terms.length).toBeGreaterThan(10);
    expect(JSON.stringify(receipt)).not.toContain('739182');

    // إشعار استلام للعميل (رقم الطلب + رابط المتابعة)
    const n = await ctx.pool.query(
      `select body, template_name from public.notifications where repair_order_id = $1 and audience = 'CUSTOMER'`, [rec.repair_order_id]);
    expect(n.rows[0].template_name).toBe('kmr_device_received');
    expect(n.rows[0].body).toContain(rec.order_number);
    expect(n.rows[0].body).toContain('/track/' + rec.tracking_token);
  });

  it('أرقام الطلبات متتالية وغير مكررة', async () => {
    const a = await walkIn(ctx, p);
    const b = await walkIn(ctx, p);
    const na = Number(a.order_number.slice(-6));
    const nb = Number(b.order_number.slice(-6));
    expect(nb).toBe(na + 1);
  });

  it('رمز قفل الجهاز مشفّر ولا يظهر إلا للفني المسند/المدير مع تسجيل في التدقيق', async () => {
    const rec = await receivedAndAssigned(ctx, p);
    const raw = await ctx.pool.query(`select passcode_encrypted::text as t from public.devices where id = $1`, [rec.device_id]);
    expect(raw.rows[0].t).not.toContain('1234');
    expect(await rpc(ctx, p.tech1, 'reveal_device_passcode', { p_order: rec.repair_order_id })).toBe('1234');
    await expectError(rpc(ctx, p.tech2, 'reveal_device_passcode', { p_order: rec.repair_order_id }), 'FORBIDDEN');
    await expectError(rpc(ctx, p.reception, 'reveal_device_passcode', { p_order: rec.repair_order_id }), 'FORBIDDEN');
    const audit = await ctx.pool.query(`select count(*)::int as n from public.audit_logs where action = 'REVEAL_PASSCODE' and record_id = $1`, [rec.device_id]);
    expect(audit.rows[0].n).toBe(1);
  });
});

describe('دورة الفني الكاملة حتى التسليم', () => {
  it('موافقة العميل ← إصلاح ← قطعة ← اختبار ← اعتماد المدير ← تسليم ← تقييم', async () => {
    const { rec, quote } = await toQuote(ctx, p, 900);
    const id = rec.repair_order_id;
    expect(await orderStatus(ctx, id)).toBe('WAITING_CUSTOMER_APPROVAL');

    // الفني لا يبدأ الإصلاح قبل موافقة العميل
    await expectError(rpc(ctx, p.tech1, 'change_repair_status', { p_order: id, p_to: 'UNDER_REPAIR' }), 'INVALID_TRANSITION');

    // العميل يرى العرض في التتبع
    const tr = await select(ctx, p.customer, `select pending_amount, pending_approval_id from public.customer_tracking where repair_order_id = $1`, [id]);
    expect(Number(tr[0].pending_amount)).toBe(900);
    expect(tr[0].pending_approval_id).toBe(quote.approval_id);

    const resp = await rpc(ctx, p.customer, 'customer_respond_quote', { p_approval: quote.approval_id, p_approve: true, p_idempotency_key: 'ap-1' });
    expect(resp.status).toBe('CUSTOMER_APPROVED');
    const again = await rpc(ctx, p.customer, 'customer_respond_quote', { p_approval: quote.approval_id, p_approve: true, p_idempotency_key: 'ap-1' });
    expect(again.replayed).toBe(true);

    const appr = await ctx.pool.query(`select status, responded_at, responded_via from public.customer_approvals where id = $1`, [quote.approval_id]);
    expect(appr.rows[0].status).toBe('APPROVED');
    expect(appr.rows[0].responded_at).toBeInstanceOf(Date);
    expect(appr.rows[0].responded_via).toBe('APP');

    await rpc(ctx, p.tech1, 'change_repair_status', { p_order: id, p_to: 'WAITING_SPARE_PART', p_public_note: 'في انتظار الشاشة' });
    await rpc(ctx, p.tech1, 'change_repair_status', { p_order: id, p_to: 'UNDER_REPAIR' });

    // قطعة من الكتالوج: السعر يتسجل وقت الاستخدام
    const sp = await ctx.pool.query(
      `insert into public.spare_parts (branch_id, name, default_price) values ($1, 'فلاتة شحن', 120) returning id`, [ctx.branchId]);
    const partId = await rpc(ctx, p.tech1, 'add_repair_part', { p_order: id, p_spare_part: sp.rows[0].id, p_qty: 1 });
    await ctx.pool.query(`update public.spare_parts set default_price = 200 where id = $1`, [sp.rows[0].id]);
    const rp = await ctx.pool.query(`select unit_price, status from public.repair_parts where id = $1`, [partId]);
    expect(Number(rp.rows[0].unit_price)).toBe(120);
    expect(rp.rows[0].status).toBe('INSTALLED');
    await expectError(ctx.pool.query(`update public.repair_parts set unit_price = 1 where id = $1`, [partId]), 'INSTALLED_PART_IMMUTABLE');

    await rpc(ctx, p.tech1, 'change_repair_status', { p_order: id, p_to: 'UNDER_TESTING' });
    await expectError(rpc(ctx, p.tech1, 'tech_finish_repair', { p_order: id, p_repair_report: 'تم' }), 'TEST_NOT_PASSED');
    await rpc(ctx, p.tech1, 'tech_record_test', { p_order: id, p_passed: true, p_notes: 'اللمس والشحن سليمين' });

    // الفني لا يستطيع الاعتماد ولا التسليم أبداً
    await expectError(rpc(ctx, p.tech1, 'approve_completion', { p_order: id }), 'FORBIDDEN');
    await expectError(rpc(ctx, p.tech1, 'change_repair_status', { p_order: id, p_to: 'READY_FOR_PICKUP' }), 'INVALID_TRANSITION');

    await rpc(ctx, p.tech1, 'tech_finish_repair', { p_order: id, p_repair_report: 'تم تغيير الشاشة والفلاتة واختبار الجهاز' });
    expect(await orderStatus(ctx, id)).toBe('WAITING_MANAGER_APPROVAL');

    // تنبيه للمدير
    const mn = await select(ctx, p.manager, `select event_key from public.notifications where recipient_profile_id = auth.uid() and repair_order_id = $1`, [id]);
    expect(mn.map((x) => x.event_key)).toContain('STAFF_WAITING_MANAGER_APPROVAL');

    await expectError(rpc(ctx, p.tech1, 'change_repair_status', { p_order: id, p_to: 'READY_FOR_PICKUP' }), 'FORBIDDEN_TRANSITION');
    await expectError(rpc(ctx, p.manager, 'change_repair_status', { p_order: id, p_to: 'READY_FOR_PICKUP' }), 'TRANSITION_REQUIRES_RPC');
    await rpc(ctx, p.manager, 'approve_completion', { p_order: id });
    expect(await orderStatus(ctx, id)).toBe('READY_FOR_PICKUP');

    // إشعار جاهزية للعميل بالقالب المعتمد
    const cn = await select(ctx, p.customer, `select template_name, body from public.notifications where repair_order_id = $1 and event_key = 'READY_FOR_PICKUP'`, [id]);
    expect(cn).toHaveLength(1);
    expect(cn[0].template_name).toBe('kmr_ready_for_pickup');
    expect(cn[0].body).toContain(rec.order_number);

    await expectError(rpc(ctx, p.reception, 'deliver_device', { p_order: id, p_received_by_name: 'العميل', p_verification_method: 'PHONE_MATCH' }), 'FORBIDDEN');
    const del = await rpc(ctx, p.manager, 'deliver_device', { p_order: id, p_received_by_name: 'عميل أول', p_verification_method: 'PHONE_MATCH' });
    expect(del.outcome).toBe('REPAIRED');
    expect(await orderStatus(ctx, id)).toBe('DELIVERED');

    const reviewId = await rpc(ctx, p.customer, 'customer_submit_review', { p_order: id, p_rating: 5, p_comment: 'خدمة ممتازة' });
    expect(reviewId).toBeTruthy();
    await expectError(rpc(ctx, p.customer, 'customer_submit_review', { p_order: id, p_rating: 4 }), 'ALREADY_REVIEWED');

    // سجل الحركة الكامل عند المدير: من استلم، من فحص، القطع، الاعتماد، التسليم
    const h = await select(ctx, p.manager,
      `select event_type, to_status, actor_role from public.repair_status_history where repair_order_id = $1 order by created_at, id`, [id]);
    const events = h.map((x) => x.event_type);
    for (const e of ['CREATED', 'TECH_ASSIGNED', 'TECH_ACCEPTED', 'DIAGNOSIS_SUBMITTED', 'PART_ADDED', 'TEST_RECORDED', 'STATUS_CHANGED']) {
      expect(events).toContain(e);
    }
    const statuses = h.filter((x) => x.event_type === 'STATUS_CHANGED').map((x) => x.to_status);
    expect(statuses).toEqual([
      'UNDER_DIAGNOSIS', 'WAITING_CUSTOMER_APPROVAL', 'CUSTOMER_APPROVED', 'WAITING_SPARE_PART', 'UNDER_REPAIR',
      'UNDER_TESTING', 'WAITING_MANAGER_APPROVAL', 'READY_FOR_PICKUP', 'DELIVERED',
    ]);
    const ready = h.find((x) => x.to_status === 'READY_FOR_PICKUP');
    expect(ready.actor_role).toBe('MANAGER');
  });

  it('رفض العميل ← يرجع لمسار التسليم بدون إصلاح', async () => {
    const { rec, quote } = await toQuote(ctx, p);
    await rpc(ctx, p.customer, 'customer_respond_quote', { p_approval: quote.approval_id, p_approve: false, p_note: 'غالي' });
    expect(await orderStatus(ctx, rec.repair_order_id)).toBe('CUSTOMER_REJECTED');
    await expectError(rpc(ctx, p.tech1, 'change_repair_status', { p_order: rec.repair_order_id, p_to: 'UNDER_REPAIR' }), 'INVALID_TRANSITION');
    await rpc(ctx, p.manager, 'change_repair_status', { p_order: rec.repair_order_id, p_to: 'READY_FOR_PICKUP', p_public_note: 'الجهاز جاهز للاستلام بدون إصلاح' });
    const d = await rpc(ctx, p.manager, 'deliver_device', { p_order: rec.repair_order_id, p_received_by_name: 'عميل أول', p_verification_method: 'ORDER_QR' });
    expect(d.outcome).toBe('RETURNED_UNREPAIRED');
  });

  it('تغيير السعر يلغي الموافقة القديمة ويطلب موافقة جديدة', async () => {
    const { rec, quote } = await toQuote(ctx, p, 500);
    const q2 = await rpc(ctx, p.manager, 'send_quote', { p_order: rec.repair_order_id, p_amount: 650, p_customer_details: 'يحتاج أيضاً تغيير فلاتة' });
    const rows = await ctx.pool.query(`select id, status from public.customer_approvals where repair_order_id = $1 order by requested_at`, [rec.repair_order_id]);
    expect(rows.rows.map((r) => r.status)).toEqual(['SUPERSEDED', 'PENDING']);
    await expectError(rpc(ctx, p.customer, 'customer_respond_quote', { p_approval: quote.approval_id, p_approve: true }), 'APPROVAL_NOT_PENDING');
    await rpc(ctx, p.customer, 'customer_respond_quote', { p_approval: q2.approval_id, p_approve: true });
    const ro = await ctx.pool.query(`select approved_cost from public.repair_orders where id = $1`, [rec.repair_order_id]);
    expect(Number(ro.rows[0].approved_cost)).toBe(650);

    // سعر جديد أثناء الإصلاح = موافقة جديدة
    await rpc(ctx, p.tech1, 'change_repair_status', { p_order: rec.repair_order_id, p_to: 'UNDER_REPAIR' });
    await rpc(ctx, p.manager, 'send_quote', { p_order: rec.repair_order_id, p_amount: 800, p_customer_details: 'ظهر عطل إضافي في البوردة' });
    expect(await orderStatus(ctx, rec.repair_order_id)).toBe('WAITING_CUSTOMER_APPROVAL');
  });

  it('الموافقة من رابط واتساب: رمز آمن + آخر 4 أرقام + صلاحية محددة', async () => {
    const { rec, quote } = await toQuote(ctx, p, 300);
    const view = await rpc(ctx, null, 'get_quote_by_token', { p_token: quote.approval_token });
    expect(Number(view.amount)).toBe(300);
    expect(JSON.stringify(view)).not.toMatch(/الفني|technician/);

    // الرمز نفسه غير مخزّن
    const stored = await ctx.pool.query(`select token_hash from public.customer_approvals where id = $1`, [quote.approval_id]);
    expect(stored.rows[0].token_hash).not.toBe(quote.approval_token);

    await expectError(rpc(ctx, null, 'respond_quote_by_token', { p_token: quote.approval_token, p_phone_last4: '0000', p_approve: true }), 'IDENTITY_CHECK_FAILED');
    await expectError(rpc(ctx, null, 'respond_quote_by_token', { p_token: 'wrong', p_phone_last4: p.customer.phone.slice(-4), p_approve: true }), 'APPROVAL_NOT_FOUND');
    await rpc(ctx, null, 'respond_quote_by_token', { p_token: quote.approval_token, p_phone_last4: p.customer.phone.slice(-4), p_approve: true });
    expect(await orderStatus(ctx, rec.repair_order_id)).toBe('CUSTOMER_APPROVED');
  });

  it('رابط موافقة منتهي الصلاحية مرفوض', async () => {
    const { quote } = await toQuote(ctx, p, 300);
    await ctx.pool.query(`update public.customer_approvals set token_expires_at = now() - interval '1 minute' where id = $1`, [quote.approval_id]);
    await expectError(
      rpc(ctx, null, 'respond_quote_by_token', { p_token: quote.approval_token, p_phone_last4: p.customer.phone.slice(-4), p_approve: true }),
      'APPROVAL_EXPIRED',
    );
  });

  it('تغيير الفني مع الاحتفاظ بسجل الفني السابق', async () => {
    const rec = await receivedAndAssigned(ctx, p, p.tech1);
    await rpc(ctx, p.manager, 'assign_technician', { p_order: rec.repair_order_id, p_technician: p.tech2.employeeId, p_reason: 'أحمد في إجازة' });

    const ta = await ctx.pool.query(
      `select technician_id, is_current, ended_at, end_reason, accepted_at from public.technician_assignments where repair_order_id = $1 order by assigned_at`,
      [rec.repair_order_id]);
    expect(ta.rows).toHaveLength(2);
    expect(ta.rows[0]).toMatchObject({ technician_id: p.tech1.employeeId, is_current: false, end_reason: 'أحمد في إجازة' });
    expect(ta.rows[0].accepted_at).toBeInstanceOf(Date);
    expect(ta.rows[1]).toMatchObject({ technician_id: p.tech2.employeeId, is_current: true });

    // الفني القديم فقد الوصول فوراً، الجديد لازم يستلم قبل الفحص
    expect(await select(ctx, p.tech1, `select id from public.repair_orders where id = $1`, [rec.repair_order_id])).toHaveLength(0);
    await expectError(rpc(ctx, p.tech1, 'change_repair_status', { p_order: rec.repair_order_id, p_to: 'UNDER_DIAGNOSIS' }), 'FORBIDDEN_TRANSITION');
    await expectError(rpc(ctx, p.tech2, 'change_repair_status', { p_order: rec.repair_order_id, p_to: 'UNDER_DIAGNOSIS' }), 'ASSIGNMENT_NOT_ACCEPTED');
    await rpc(ctx, p.tech2, 'tech_accept_assignment', { p_order: rec.repair_order_id });
    await rpc(ctx, p.tech2, 'change_repair_status', { p_order: rec.repair_order_id, p_to: 'UNDER_DIAGNOSIS' });

    const h = await ctx.pool.query(`select metadata from public.repair_status_history where repair_order_id = $1 and event_type = 'TECH_CHANGED'`, [rec.repair_order_id]);
    expect(h.rows[0].metadata.previous_technician_id).toBe(p.tech1.employeeId);
  });

  it('المدير يطلب إعادة فحص بدل الاعتماد', async () => {
    const { rec, quote } = await toQuote(ctx, p);
    await rpc(ctx, p.customer, 'customer_respond_quote', { p_approval: quote.approval_id, p_approve: true });
    const id = rec.repair_order_id;
    await rpc(ctx, p.tech1, 'change_repair_status', { p_order: id, p_to: 'UNDER_REPAIR' });
    await rpc(ctx, p.tech1, 'change_repair_status', { p_order: id, p_to: 'UNDER_TESTING' });
    await rpc(ctx, p.tech1, 'tech_record_test', { p_order: id, p_passed: true, p_notes: 'ok' });
    await rpc(ctx, p.tech1, 'tech_finish_repair', { p_order: id, p_repair_report: 'تم تغيير الشاشة' });
    await expectError(rpc(ctx, p.manager, 'request_recheck', { p_order: id, p_reason: '' }), 'REASON_REQUIRED');
    await rpc(ctx, p.manager, 'request_recheck', { p_order: id, p_reason: 'فيه بكسل ميت في الشاشة' });
    expect(await orderStatus(ctx, id)).toBe('UNDER_REPAIR');
    // لازم اختبار جديد قبل الإنهاء مرة أخرى
    await rpc(ctx, p.tech1, 'change_repair_status', { p_order: id, p_to: 'UNDER_TESTING' });
    await expectError(rpc(ctx, p.tech1, 'tech_finish_repair', { p_order: id, p_repair_report: 'تم' }), 'TEST_NOT_PASSED');
  });
});

describe('الإشعارات', () => {
  it('لا تتكرر الإشعارات عند إعادة تنفيذ نفس العملية (idempotency)', async () => {
    const { rec } = await toQuote(ctx, p);
    const before = await ctx.pool.query(`select count(*)::int as n from public.notifications where repair_order_id = $1`, [rec.repair_order_id]);
    // نفس مفتاح العملية مرتين
    const id = rec.repair_order_id;
    const q1 = await rpc(ctx, p.manager, 'send_quote', { p_order: id, p_amount: 700, p_customer_details: 'تعديل', p_idempotency_key: 'q-dup' });
    const q2 = await rpc(ctx, p.manager, 'send_quote', { p_order: id, p_amount: 700, p_customer_details: 'تعديل', p_idempotency_key: 'q-dup' });
    expect(q2.approval_id).toBe(q1.approval_id);
    const after = await ctx.pool.query(`select count(*)::int as n from public.notifications where repair_order_id = $1`, [rec.repair_order_id]);
    expect(after.rows[0].n - before.rows[0].n).toBe(1); // QUOTE_REVISED مرة واحدة فقط
  });

  it('سجل الإرسال لكل قناة مرة واحدة (unique notification_id + channel)', async () => {
    await ctx.pool.query(`update public.repair_settings set whatsapp_enabled = true, push_enabled = true`);
    const rec = await walkIn(ctx, p);
    const logs = await ctx.pool.query(
      `select l.channel from public.notification_logs l join public.notifications n on n.id = l.notification_id
        where n.repair_order_id = $1 and n.audience = 'CUSTOMER' order by l.channel`, [rec.repair_order_id]);
    expect(logs.rows.map((r) => r.channel)).toEqual(['WHATSAPP', 'FCM']);
    const nId = (await ctx.pool.query(`select id from public.notifications where repair_order_id = $1 and audience = 'CUSTOMER'`, [rec.repair_order_id])).rows[0].id;
    await expectError(ctx.pool.query(`insert into public.notification_logs (notification_id, channel) values ($1, 'WHATSAPP')`, [nId]), 'duplicate key');
    await ctx.pool.query(`update public.repair_settings set whatsapp_enabled = false, push_enabled = false`);
  });

  it('العميل يقرأ إشعاراته ويعلّمها مقروءة، ولا يرى إشعارات غيره', async () => {
    const mine = await select(ctx, p.customer, `select id from public.notifications`);
    expect(mine.length).toBeGreaterThan(0);
    const n = await rpc(ctx, p.customer, 'mark_notifications_read', { p_ids: mine.map((r) => r.id) });
    expect(n).toBe(mine.length);
    expect(await select(ctx, p.other, `select id from public.notifications where id = any($1)`, [mine.map((r) => r.id)])).toHaveLength(0);
  });
});
