import { AppShell } from '@/components/AppShell';
import { requireRole } from '@/lib/guard';
import { TechOrder } from './TechOrder';

export const metadata = { title: 'جهاز — خالد لصيانة المحمول' };

export default async function TechOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireRole(['TECHNICIAN', 'MANAGER', 'ADMIN']);
  const { id } = await params;
  return (
    <AppShell me={me} nav={[{ href: '/tech', label: '🔧 أجهزتي' }]}>
      <TechOrder id={id} />
    </AppShell>
  );
}
