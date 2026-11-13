import { AppShell } from '@/components/AppShell';
import { requireRole } from '@/lib/guard';
import { staffNav } from '@/lib/nav';
import { PartsCatalog } from './PartsCatalog';

export const metadata = { title: 'قطع الغيار — خالد لصيانة المحمول' };

export default async function PartsPage() {
  const me = await requireRole(['ADMIN', 'MANAGER']);
  return (
    <AppShell me={me} nav={staffNav(me.role)}>
      <h1 className="mb-4 text-2xl font-bold">كتالوج قطع الغيار</h1>
      <div className="mx-auto max-w-3xl"><PartsCatalog /></div>
    </AppShell>
  );
}
