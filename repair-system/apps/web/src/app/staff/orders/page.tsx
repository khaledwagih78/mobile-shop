import { Suspense } from 'react';
import { AppShell } from '@/components/AppShell';
import { requireRole } from '@/lib/guard';
import { FRONT_OFFICE, staffNav } from '@/lib/nav';
import { OrdersList } from './OrdersList';

export const metadata = { title: 'كل الأجهزة — خالد لصيانة المحمول' };

export default async function OrdersPage() {
  const me = await requireRole(FRONT_OFFICE);
  return (
    <AppShell me={me} nav={staffNav(me.role)}>
      <h1 className="mb-4 text-2xl font-bold">كل الأجهزة</h1>
      <Suspense><OrdersList /></Suspense>
    </AppShell>
  );
}
