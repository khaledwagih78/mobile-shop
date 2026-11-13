import { AppShell } from '@/components/AppShell';
import { requireRole } from '@/lib/guard';
import { staffNav } from '@/lib/nav';
import { SettingsForm } from './SettingsForm';

export const metadata = { title: 'إعدادات المحل — خالد لصيانة المحمول' };

export default async function SettingsPage() {
  const me = await requireRole(['ADMIN', 'MANAGER']);
  return (
    <AppShell me={me} nav={staffNav(me.role)}>
      <h1 className="mb-4 text-2xl font-bold">إعدادات المحل</h1>
      <div className="mx-auto max-w-3xl"><SettingsForm /></div>
    </AppShell>
  );
}
