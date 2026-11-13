import { Suspense } from 'react';
import { AppShell } from '@/components/AppShell';
import { requireRole } from '@/lib/guard';
import { FRONT_OFFICE, staffNav } from '@/lib/nav';
import { IntakeForm } from './IntakeForm';

export const metadata = { title: 'استلام جهاز — خالد لصيانة المحمول' };

export default async function IntakePage() {
  const me = await requireRole(FRONT_OFFICE);
  return (
    <AppShell me={me} nav={staffNav(me.role)}>
      <h1 className="mb-4 text-2xl font-bold">استلام جهاز</h1>
      <div className="mx-auto max-w-3xl"><Suspense><IntakeForm /></Suspense></div>
    </AppShell>
  );
}
