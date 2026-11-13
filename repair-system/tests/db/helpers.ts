import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { TEMPLATE_DB, withDb } from './global-setup';

export type Role = 'ADMIN' | 'MANAGER' | 'RECEPTIONIST' | 'TECHNICIAN' | 'CUSTOMER';

export interface Ctx {
  pool: pg.Pool; // superuser pool (= service role / SQL editor)
  dbName: string;
  branchId: string;
}

export interface User {
  id: string;
  phone: string;
  role: Role;
  employeeId?: string;
  customerId?: string;
}

/** Fresh isolated database cloned from the migrated template. */
export async function setupDb(): Promise<Ctx> {
  const base = process.env.TEST_DATABASE_URL!;
  const dbName = 'kmr_t_' + randomUUID().replace(/-/g, '').slice(0, 12);
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  await admin.query(`create database ${dbName} template ${TEMPLATE_DB}`);
  await admin.end();
  const pool = new pg.Pool({ connectionString: withDb(base, dbName), max: 8 });
  const b = await pool.query(`select id from public.branches where code = 'MAIN'`);
  return { pool, dbName, branchId: b.rows[0].id };
}

export async function teardownDb(ctx: Ctx) {
  await ctx.pool.end();
  const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL! });
  await admin.connect();
  await admin.query(`drop database if exists ${ctx.dbName} with (force)`);
  await admin.end();
}

let phoneSeq = 0;
export function nextPhone() {
  phoneSeq += 1;
  return '+2010' + String(Math.floor(Math.random() * 1e4)).padStart(4, '0') + String(phoneSeq).padStart(4, '0');
}

/** Simulates Supabase Auth sign-up (row in auth.users -> handle_new_user trigger). */
export async function signUp(ctx: Ctx, name: string, phone = nextPhone()): Promise<User> {
  const r = await ctx.pool.query(
    `insert into auth.users (phone, raw_user_meta_data) values ($1, jsonb_build_object('full_name', $2::text)) returning id`,
    [phone, name],
  );
  const id = r.rows[0].id as string;
  const c = await ctx.pool.query(`select id from public.customers where profile_id = $1`, [id]);
  return { id, phone, role: 'CUSTOMER', customerId: c.rows[0]?.id };
}

/** Creates a staff account. The first ADMIN is bootstrapped by SQL (as documented for production). */
export async function createStaff(ctx: Ctx, role: Exclude<Role, 'CUSTOMER'>, name: string, by?: User): Promise<User> {
  const u = await signUp(ctx, name);
  // staff accounts are not customers
  await ctx.pool.query(`update public.customers set profile_id = null, deleted_at = now() where profile_id = $1`, [u.id]);
  if (by) {
    await rpc(ctx, by, 'admin_set_role', { p_profile: u.id, p_role: role, p_branch: ctx.branchId });
  } else {
    await ctx.pool.query(`update public.profiles set role = $2, branch_id = $3 where id = $1`, [u.id, role, ctx.branchId]);
    await ctx.pool.query(
      `insert into public.employees (profile_id, branch_id) values ($1, $2) on conflict (profile_id) do nothing`,
      [u.id, ctx.branchId],
    );
  }
  const e = await ctx.pool.query(`select id from public.employees where profile_id = $1`, [u.id]);
  return { id: u.id, phone: u.phone, role, employeeId: e.rows[0]?.id };
}

/** Runs fn inside a transaction as the given user (role authenticated + JWT claims), like PostgREST does. */
export async function as<T>(ctx: Ctx, user: User | null, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await ctx.pool.connect();
  try {
    await c.query('begin');
    if (user) {
      await c.query(`set local role authenticated`);
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: user.id, role: 'authenticated' }),
      ]);
    } else {
      await c.query(`set local role anon`);
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'anon' })]);
    }
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

function toParam(v: unknown) {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.length && typeof v[0] === 'object' ? JSON.stringify(v) : v;
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

/** Calls an RPC with named arguments, like supabase.rpc(name, args). */
export async function rpc<T = any>(ctx: Ctx, user: User | null, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const keys = Object.keys(args);
  const params = keys.map((k, i) => `${k} => $${i + 1}`).join(', ');
  const values = keys.map((k) => toParam(args[k]));
  return as(ctx, user, async (c) => {
    const r = await c.query(`select public.${name}(${params}) as result`, values);
    return r.rows[0].result as T;
  });
}

/** Selects as a user (RLS applies). */
export async function select<T = any>(ctx: Ctx, user: User | null, sql: string, values: unknown[] = []): Promise<T[]> {
  return as(ctx, user, async (c) => (await c.query(sql, values)).rows as T[]);
}

export async function expectError(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e) {
    const msg = (e as Error).message;
    if (!msg.includes(code)) throw new Error(`Expected error ${code}, got: ${msg}`);
    return msg;
  }
  throw new Error(`Expected error ${code}, but the call succeeded`);
}

export async function orderStatus(ctx: Ctx, orderId: string): Promise<string> {
  return (await ctx.pool.query(`select status from public.repair_orders where id = $1`, [orderId])).rows[0].status;
}

export const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

/** Standard cast of users for most tests. */
export async function cast(ctx: Ctx) {
  const admin = await createStaff(ctx, 'ADMIN', 'خالد');
  const manager = await createStaff(ctx, 'MANAGER', 'مدير الفرع', admin);
  const reception = await createStaff(ctx, 'RECEPTIONIST', 'موظف الاستقبال', admin);
  const tech1 = await createStaff(ctx, 'TECHNICIAN', 'الفني أحمد', admin);
  const tech2 = await createStaff(ctx, 'TECHNICIAN', 'الفني محمود', admin);
  const customer = await signUp(ctx, 'عميل أول');
  const other = await signUp(ctx, 'عميل تاني');
  return { admin, manager, reception, tech1, tech2, customer, other };
}
export type Cast = Awaited<ReturnType<typeof cast>>;

export interface Intake {
  repair_order_id: string;
  order_number: string;
  tracking_token: string;
  device_id: string;
}

/** Walk-in intake by reception for people.customer. */
export async function walkIn(ctx: Ctx, people: Cast, extra: Record<string, unknown> = {}): Promise<Intake> {
  return rpc(ctx, people.reception, 'receive_device', {
    p: {
      customer_id: people.customer.customerId,
      device: { device_type: 'PHONE', brand: 'Samsung', model: 'A52', color: 'أسود', imei: '356789012345678' },
      issue_description: 'الشاشة مكسورة واللمس لا يعمل',
      intake_condition: 'خدوش خفيفة على الظهر',
      intake_damages: [{ area: 'الشاشة', note: 'كسر في الركن' }],
      accessories: ['جراب'],
      passcode: '1234',
      ...extra,
    },
  });
}

/** Intake + assign + accept: order is ready for the technician to start diagnosis. */
export async function receivedAndAssigned(ctx: Ctx, people: Cast, tech = people.tech1): Promise<Intake> {
  const rec = await walkIn(ctx, people);
  await rpc(ctx, people.manager, 'assign_technician', { p_order: rec.repair_order_id, p_technician: tech.employeeId });
  await rpc(ctx, tech, 'tech_accept_assignment', { p_order: rec.repair_order_id });
  return rec;
}

/** Drives an order to WAITING_CUSTOMER_APPROVAL and returns the quote result. */
export async function toQuote(ctx: Ctx, people: Cast, amount = 850) {
  const rec = await receivedAndAssigned(ctx, people);
  await rpc(ctx, people.tech1, 'change_repair_status', { p_order: rec.repair_order_id, p_to: 'UNDER_DIAGNOSIS' });
  await rpc(ctx, people.tech1, 'tech_submit_diagnosis', {
    p_order: rec.repair_order_id,
    p_findings: 'كسر في الشاشة الأصلية وتلف في الفلاتة',
    p_proposed_solution: 'تغيير الشاشة كاملة',
    p_fault_category: 'شاشة',
    p_estimated_minutes: 60,
    p_parts: [{ part_name: 'شاشة Samsung A52 أصلية', qty: 1 }],
  });
  const quote = await rpc(ctx, people.manager, 'send_quote', {
    p_order: rec.repair_order_id,
    p_amount: amount,
    p_customer_details: 'الشاشة مكسورة وتحتاج تغيير كامل بشاشة أصلية',
  });
  return { rec, quote };
}
