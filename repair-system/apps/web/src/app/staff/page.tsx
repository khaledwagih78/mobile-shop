import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { requireRole } from '@/lib/guard';
import { FRONT_OFFICE, staffNav } from '@/lib/nav';
import { Dashboard } from './Dashboard';

export const metadata = { title: 'لوحة التحكم — خالد لصيانة المحمول' };

export default async function StaffHome() {
  const me = await requireRole(FRONT_OFFICE);
  return (
    <AppShell me={me} nav={staffNav(me.role)}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">أهلاً {me.full_name ?? ''}</h1>
        <Link href="/staff/intake" className="btn-primary">📥 استلام جهاز جديد</Link>
      </div>
      <Dashboard />
    </AppShell>
  );
}
