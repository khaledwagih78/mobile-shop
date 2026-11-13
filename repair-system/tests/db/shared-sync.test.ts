// يتأكد إن ثوابت @kmr/shared (اللي الواجهات بتستخدمها للعرض) مطابقة لقاعدة البيانات.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { REPAIR_STATUSES, STATUS_LABELS, TRANSITIONS, normalizePhone } from '../../packages/shared/src/index';
import { type Ctx, setupDb, teardownDb } from './helpers';

let ctx: Ctx;
beforeAll(async () => { ctx = await setupDb(); });
afterAll(async () => teardownDb(ctx));

it('الحالات والترجمة مطابقة للـ enum', async () => {
  const r = await ctx.pool.query(`select unnest(enum_range(null::public.repair_status))::text as s`);
  expect(r.rows.map((x) => x.s)).toEqual([...REPAIR_STATUSES]);
  for (const s of REPAIR_STATUSES) {
    const l = await ctx.pool.query(`select public.repair_status_label($1) as l`, [s]);
    expect(l.rows[0].l).toBe(STATUS_LABELS[s]);
  }
});

it('جدول الانتقالات مطابق', async () => {
  const r = await ctx.pool.query(`select from_status, to_status, actors, via_rpc from public.status_transitions`);
  const db = r.rows.map((x) => `${x.from_status}>${x.to_status}|${[...x.actors].sort().join(',')}|${x.via_rpc ?? ''}`).sort();
  const ts = TRANSITIONS.map((t) => `${t.from}>${t.to}|${[...t.actors].sort().join(',')}|${t.viaRpc ?? ''}`).sort();
  expect(ts).toEqual(db);
});

it('تطبيع أرقام الهاتف مطابق', async () => {
  for (const ph of ['01012345678', '+201012345678', '00201012345678', '010 1234 5678']) {
    const r = await ctx.pool.query(`select private.normalize_phone($1) as p`, [ph]);
    expect(normalizePhone(ph)).toBe(r.rows[0].p);
  }
});
