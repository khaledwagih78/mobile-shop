import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { requireRole } from '@/lib/guard';
import { staffNav } from '@/lib/nav';

export default async function StaffHome() {
  const me = await requireRole(['ADMIN', 'MANAGER', 'RECEPTIONIST']);
  return (
    <AppShell me={me} nav={staffNav(me.role)}>
      <h1 className="text-2xl font-bold">أهلاً {me.full_name ?? ''}</h1>
      <p className="mt-2 text-slate-500">لوحة تحكم المحل.</p>
      {me.role === 'ADMIN' && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Link href="/admin/users" className="card block hover:border-brand">
            <div className="text-lg font-bold">👥 إدارة المستخدمين</div>
            <p className="mt-1 text-sm text-slate-500">ترقية حساب لموظف/فني، تغيير الصلاحيات، إيقاف حساب.</p>
          </Link>
        </div>
      )}
    </AppShell>
  );
}
