// يبني قاعدة بيانات "قالب" مرة واحدة: shim + كل الـ migrations + seed.
// كل ملف اختبار بعد كده بياخد نسخة مستقلة من القالب (سريع ومعزول).
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const ROOT = join(import.meta.dirname, '..', '..');
export const TEMPLATE_DB = 'kmr_template';

export function withDb(url: string, db: string) {
  const u = new URL(url);
  u.pathname = '/' + db;
  return u.toString();
}

export default async function setup() {
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    url = execSync(`bash ${join(ROOT, 'scripts', 'pg-local.sh')} start`).toString().trim();
    process.env.TEST_DATABASE_URL = url;
  }
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  const old = await admin.query(`select datname from pg_database where datname like 'kmr\\_%'`);
  for (const r of old.rows) await admin.query(`drop database if exists "${r.datname}" with (force)`);
  await admin.query(`create database ${TEMPLATE_DB}`);
  await admin.end();

  const c = new pg.Client({ connectionString: withDb(url, TEMPLATE_DB) });
  await c.connect();
  const files = [
    join(ROOT, 'supabase', 'tests', 'supabase_shim.sql'),
    ...readdirSync(join(ROOT, 'supabase', 'migrations'))
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => join(ROOT, 'supabase', 'migrations', f)),
    join(ROOT, 'supabase', 'seed.sql'),
  ];
  for (const f of files) {
    try {
      await c.query(readFileSync(f, 'utf8'));
    } catch (e) {
      throw new Error(`Migration failed: ${f}\n${(e as Error).message}`);
    }
  }
  await c.end();
}
