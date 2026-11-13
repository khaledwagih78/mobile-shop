// تعدد المستخدمين، تكرار الطلبات (انقطاع النت + إعادة الإرسال)، وتضارب التعديلات.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Cast, type Ctx, cast, expectError, orderStatus, receivedAndAssigned, rpc, select, setupDb, teardownDb, toQuote,
} from './helpers';

let ctx: Ctx;
let p: Cast;

beforeAll(async () => {
  ctx = await setupDb();
  p = await cast(ctx);
});
afterAll(async () => teardownDb(ctx));

const intake = (key?: string) => ({
  p: {
    customer_id: p.customer.customerId,
    device: { brand: 'Infinix', model: 'Hot 30' },
    issue_description: 'مشكلة في الشحن',
    ...(key ? { idempotency_key: key } : {}),
  },
});

describe('تكرار إرسال الطلبات', () => {
  it('نفس مفتاح العملية بالتوازي ينشئ طلب واحد فقط', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => rpc(ctx, p.reception, 'receive_device', intake('same-key'))));
    const ids = new Set(results.map((r) => r.repair_order_id));
    expect(ids.size).toBe(1);
    const n = await ctx.pool.query(`select count(*)::int as n from public.repair_orders where order_number = $1`, [results[0].order_number]);
    expect(n.rows[0].n).toBe(1);
  });

  it('إعادة المحاولة بعد انقطاع الاتصال ترجع نفس النتيجة', async () => {
    const first = await rpc(ctx, p.reception, 'receive_device', intake('retry-1'));
    const retry = await rpc(ctx, p.reception, 'receive_device', intake('retry-1'));
    expect(retry.repair_order_id).toBe(first.repair_order_id);
    expect(retry.replayed).toBe(true);
  });

  it('مفتاح نفس العملية لمستخدم مختلف لا يتعارض', async () => {
    const a = await rpc(ctx, p.reception, 'receive_device', intake('shared'));
    const b = await rpc(ctx, p.manager, 'receive_device', intake('shared'));
    expect(a.repair_order_id).not.toBe(b.repair_order_id);
  });

  it('عملية فشلت لا تحجز المفتاح (rollback)', async () => {
    await expectError(rpc(ctx, p.reception, 'receive_device', { p: { customer_id: p.customer.customerId, device: { brand: 'X', model: 'Y' }, issue_description: '', idempotency_key: 'bad-1' } }), 'ISSUE_REQUIRED');
    const ok = await rpc(ctx, p.reception, 'receive_device', intake('bad-1'));
    expect(ok.repair_order_id).toBeTruthy();
    expect(ok.replayed).toBeUndefined();
  });
});

describe('تعدد المستخدمين', () => {
  it('أرقام طلبات فريدة تحت ضغط متوازي', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => rpc(ctx, p.reception, 'receive_device', intake())));
    const nums = results.map((r) => r.order_number);
    expect(new Set(nums).size).toBe(20);
  });

  it('موافقة العميل مرتين بالتوازي: واحدة فقط تنجح', async () => {
    const { rec, quote } = await toQuote(ctx, p);
    const settled = await Promise.allSettled([
      rpc(ctx, p.customer, 'customer_respond_quote', { p_approval: quote.approval_id, p_approve: true }),
      rpc(ctx, p.customer, 'customer_respond_quote', { p_approval: quote.approval_id, p_approve: false }),
    ]);
    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
    const st = await orderStatus(ctx, rec.repair_order_id);
    expect(['CUSTOMER_APPROVED', 'CUSTOMER_REJECTED']).toContain(st);
    const h = await ctx.pool.query(
      `select count(*)::int as n from public.repair_status_history where repair_order_id = $1 and to_status in ('CUSTOMER_APPROVED','CUSTOMER_REJECTED')`, [rec.repair_order_id]);
    expect(h.rows[0].n).toBe(1);
  });

  it('تضارب التعديلات: expected_version قديم يُرفض', async () => {
    const rec = await receivedAndAssigned(ctx, p);
    const [{ version }] = await select(ctx, p.tech1, `select version from public.repair_orders where id = $1`, [rec.repair_order_id]);
    await rpc(ctx, p.tech1, 'change_repair_status', { p_order: rec.repair_order_id, p_to: 'UNDER_DIAGNOSIS', p_expected_version: version });
    // شاشة تانية لسه شايفة النسخة القديمة
    await expectError(
      rpc(ctx, p.manager, 'change_repair_status', { p_order: rec.repair_order_id, p_to: 'READY_FOR_PICKUP', p_expected_version: version }),
      'VERSION_CONFLICT',
    );
  });

  it('التغيير من المدير يظهر فوراً للعميل والفني (نفس قاعدة البيانات المركزية)', async () => {
    const rec = await receivedAndAssigned(ctx, p);
    await rpc(ctx, p.tech1, 'change_repair_status', { p_order: rec.repair_order_id, p_to: 'UNDER_DIAGNOSIS' });
    const [c] = await select(ctx, p.customer, `select status, status_label from public.customer_tracking where repair_order_id = $1`, [rec.repair_order_id]);
    expect(c).toEqual({ status: 'UNDER_DIAGNOSIS', status_label: 'تحت الفحص' });
    const [t] = await select(ctx, p.tech1, `select status from public.repair_orders where id = $1`, [rec.repair_order_id]);
    expect(t.status).toBe('UNDER_DIAGNOSIS');
  });

  it('الجداول المطلوبة منشورة على Realtime', async () => {
    const r = await ctx.pool.query(`select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1`);
    expect(r.rows.map((x) => x.tablename)).toEqual(
      ['bookings', 'customer_tracking', 'notifications', 'repair_orders', 'technician_assignments']);
  });
});
