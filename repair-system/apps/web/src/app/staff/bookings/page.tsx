import { Suspense } from 'react';
import { AppShell } from '@/components/AppShell';
import { requireRole } from '@/lib/guard';
import { FRONT_OFFICE, staffNav } from '@/lib/nav';
import { BookingsBoard } from './BookingsBoard';

export const metadata = { title: 'الحجوزات — خالد لصيانة المحمول' };

export default async function BookingsPage() {
  const me = await requireRole(FRONT_OFFICE);
  return (
    <AppShell me={me} nav={staffNav(me.role)}>
      <h1 className="mb-4 text-2xl font-bold">الحجوزات</h1>
      <Suspense><BookingsBoard /></Suspense>
    </AppShell>
  );
}
