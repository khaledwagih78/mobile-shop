// المرحلة 4: شاشات الفني + كتالوج قطع الغيار
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Cast, type Ctx, type Intake, cast, expectError, receivedAndAssigned, rpc, select, setupDb, teardownDb, walkIn,
} from './helpers';

let ctx: Ctx;
let p: Cast;
let mine: Intake;
let notAccepted: Intake;
let others: Intake;

beforeAll(async () => {
  ctx = await setupDb();
  p = await cast(ctx);
  mine = await receivedAndAssigned(ctx, p, p.tech1);
  notAccepted = await walkIn(ctx, p);
  await rpc(ctx, p.manager, 'assign_technician', { p_order: notAccepted.repair_order_id, p_technician: p.tech1.employeeId });
  others = await receivedAndAssigned(ctx, p, p.tech2);
});
afterAll(async () => teardownDb(ctx));

describe('أجهزتي', () => {
  it('الفني يشوف أجهزته بس، والجديدة (لسه ما استلمهاش) فوق', async () => {
    const rows = await select(ctx, p.tech1, `select * from public.tech_my_orders()`);
    expect(rows.map((r) => r.id)).toEqual([notAccepted.repair_order_id, mine.repair_order_id]);
    expect(rows[0].accepted_at).toBeNull();
    expect(rows.map((r) => r.id)).not.toContain(others.repair_order_id);
  });

  it('مفيش أي بيانات عميل في قائمة الفني أو تفاصيله', async () => {
    const rows = await select(ctx, p.tech1, `select * from public.tech_my_orders()`);
    const d = await rpc(ctx, p.tech1, 'tech_order_details', { p_order: mine.repair_order_id });
    const blob = JSON.stringify({ rows, d });
    expect(blob).not.toContain('عميل أول');
    expect(blob).not.toContain(p.customer.phone);
    expect(blob).not.toContain(p.customer.phone.slice(3));
    expect(d.device.has_passcode).toBe(true);
    expect(blob).not.toContain('passcode_encrypted');
    expect(d.assignment.accepted_at).toBeTruthy();
  });

  it('تفاصيل جهاز فني تاني ممنوعة، وكمان بعد نقل الجهاز منه', async () => {
    await expectError(rpc(ctx, p.tech1, 'tech_order_details', { p_order: others.repair_order_id }), 'FORBIDDEN');
    await rpc(ctx, p.manager, 'assign_technician', { p_order: mine.repair_order_id, p_technician: p.tech2.employeeId, p_reason: 'ضغط شغل' });
    await expectError(rpc(ctx, p.tech1, 'tech_order_details', { p_order: mine.repair_order_id }), 'FORBIDDEN');
    expect((await select(ctx, p.tech1, `select id from public.tech_my_orders()`)).map((r) => r.id)).not.toContain(mine.repair_order_id);
    // رجّعه للفني الأول عشان باقي الاختبارات
    await rpc(ctx, p.manager, 'assign_technician', { p_order: mine.repair_order_id, p_technician: p.tech1.employeeId });
  });

  it('العميل والاستقبال لا يستخدمون شاشات الفني', async () => {
    await expectError(select(ctx, p.customer, `select * from public.tech_my_orders()`), 'FORBIDDEN');
    await expectError(rpc(ctx, p.reception, 'tech_order_details', { p_order: mine.repair_order_id }), 'FORBIDDEN');
  });

  it('الجهاز المسلّم يختفي من قائمة الفني', async () => {
    const rec = await receivedAndAssigned(ctx, p, p.tech1);
    await rpc(ctx, p.manager, 'change_repair_status', { p_order: rec.repair_order_id, p_to: 'READY_FOR_PICKUP', p_public_note: 'العميل سحب الجهاز' });
    await rpc(ctx, p.manager, 'deliver_device', { p_order: rec.repair_order_id, p_received_by_name: 'عميل أول', p_verification_method: 'PHONE_MATCH' });
    expect((await select(ctx, p.tech1, `select id from public.tech_my_orders()`)).map((r) => r.id)).not.toContain(rec.repair_order_id);
  });
});

describe('كتالوج قطع الغيار', () => {
  it('المدير يضيف ويعدّل، والفني يبحث، والسعر يتسجل وقت الاستخدام', async () => {
    const id = await rpc(ctx, p.manager, 'upsert_spare_part', {
      p: { name: 'شاشة A52 أصلي', brand: 'Samsung', default_price: 1200, compatible_models: ['A52', 'A52s'] },
    });
    const found = await select(ctx, p.tech1, `select id, default_price from public.search_spare_parts('a52s')`);
    expect(found.map((r) => r.id)).toContain(id);

    await rpc(ctx, p.tech1, 'tech_accept_assignment', { p_order: notAccepted.repair_order_id });
    await rpc(ctx, p.tech1, 'change_repair_status', { p_order: notAccepted.repair_order_id, p_to: 'UNDER_DIAGNOSIS' });
    const partId = await rpc(ctx, p.tech1, 'add_repair_part', { p_order: notAccepted.repair_order_id, p_spare_part: id, p_status: 'REQUIRED' });

    await rpc(ctx, p.manager, 'upsert_spare_part', { p: { id, name: 'شاشة A52 أصلي', default_price: 1500 } });
    const rp = await ctx.pool.query(`select unit_price from public.repair_parts where id = $1`, [partId]);
    expect(Number(rp.rows[0].unit_price)).toBe(1200);
  });

  it('الفني والاستقبال لا يعدّلون الكتالوج، والمعطّل مايظهرش للفني', async () => {
    await expectError(rpc(ctx, p.tech1, 'upsert_spare_part', { p: { name: 'xx', default_price: 1 } }), 'FORBIDDEN');
    await expectError(rpc(ctx, p.reception, 'upsert_spare_part', { p: { name: 'xx', default_price: 1 } }), 'FORBIDDEN');
    const id = await rpc(ctx, p.manager, 'upsert_spare_part', { p: { name: 'فلاتة قديمة', default_price: 50, is_active: false } });
    expect((await select(ctx, p.tech1, `select id from public.search_spare_parts('فلاتة قديمة')`))).toHaveLength(0);
    expect((await select(ctx, p.manager, `select id from public.search_spare_parts('فلاتة قديمة', true)`)).map((r) => r.id)).toEqual([id]);
    await expectError(rpc(ctx, p.manager, 'upsert_spare_part', { p: { name: 'x1', default_price: -5 } }), 'INVALID_AMOUNT');
  });

  it('قائمة أنواع الأعطال', async () => {
    const r = await select(ctx, p.tech1, `select public.fault_categories() as c`);
    expect(r[0].c).toContain('شاشة');
  });
});

describe('رابط الموافقة', () => {
  it('رابط نسبي /approve/<48 hex> لما رابط الموقع فاضي، ومطلق لما يتحدد', async () => {
    const { toQuote } = await import('./helpers');
    const q1 = await toQuote(ctx, p);
    expect(q1.quote.approval_url).toMatch(/^\/approve\/[0-9a-f]{48}$/);
    await ctx.pool.query(`update public.repair_settings set tracking_base_url = 'https://shop.example'`);
    const q2 = await toQuote(ctx, p);
    expect(q2.quote.approval_url).toMatch(/^https:\/\/shop\.example\/approve\/[0-9a-f]{48}$/);
  });
});
