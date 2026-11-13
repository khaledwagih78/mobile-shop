import { AppShell } from '@/components/AppShell';
import { requireRole } from '@/lib/guard';
import { staffNav } from '@/lib/nav';
import { UsersManager } from './UsersManager';

export const metadata = { title: 'المستخدمين — خالد لصيانة المحمول' };

export default async function UsersPage() {
  const me = await requireRole(['ADMIN']);
  return (
    <AppShell me={me} nav={staffNav(me.role)}>
      <h1 className="mb-4 text-2xl font-bold">إدارة المستخدمين</h1>
      <UsersManager meId={me.id} />
    </AppShell>
  );
}
