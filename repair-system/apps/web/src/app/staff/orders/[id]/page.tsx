import { AppShell } from '@/components/AppShell';
import { requireRole } from '@/lib/guard';
import { FRONT_OFFICE, staffNav } from '@/lib/nav';
import { OrderDetails } from './OrderDetails';

export const metadata = { title: 'تفاصيل الجهاز — خالد لصيانة المحمول' };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireRole(FRONT_OFFICE);
  const { id } = await params;
  return (
    <AppShell me={me} nav={staffNav(me.role)}>
      <OrderDetails id={id} role={me.role} branchId={me.branch_id}
        canManage={me.role === 'ADMIN' || me.role === 'MANAGER'} />
    </AppShell>
  );
}
