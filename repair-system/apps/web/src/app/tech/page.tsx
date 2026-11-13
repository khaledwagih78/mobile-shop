import { AppShell } from '@/components/AppShell';
import { requireRole } from '@/lib/guard';
import { TechHome } from './TechHome';

export const metadata = { title: 'أجهزتي — خالد لصيانة المحمول' };

export default async function TechPage() {
  const me = await requireRole(['TECHNICIAN', 'MANAGER', 'ADMIN']);
  const nav = [{ href: '/tech', label: '🔧 أجهزتي' }];
  if (me.role !== 'TECHNICIAN') nav.push({ href: '/staff', label: '📊 لوحة المحل' });
  return (
    <AppShell me={me} nav={nav}>
      <h1 className="mb-4 text-2xl font-bold">أجهزتي</h1>
      <TechHome />
    </AppShell>
  );
}
