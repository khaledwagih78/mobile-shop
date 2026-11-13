import { Suspense } from 'react';
import { AppShell } from '@/components/AppShell';
import { requireRole } from '@/lib/guard';
import { FRONT_OFFICE, staffNav } from '@/lib/nav';
import { OrdersList } from './OrdersList';

export const metadata = { title: 'كل الأجهزة — خالد لصيانة المحمول' };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const me = await requireRole(FRONT_OFFICE);
  const sp = await searchParams;
  return (
    <AppShell me={me} nav={staffNav(me.role)}>
      <h1 className="mb-4 text-2xl font-bold">
        {sp.status === 'WAITING_MANAGER_APPROVAL' ? 'أجهزة تنتظر اعتمادك' : sp.status === 'READY_FOR_PICKUP' ? 'أجهزة جاهزة للتسليم' : 'كل الأجهزة'}
      </h1>
      {/* key: navigating between filtered links re-initializes the filters */}
      <Suspense><OrdersList key={JSON.stringify(sp)} /></Suspense>
    </AppShell>
  );
}
