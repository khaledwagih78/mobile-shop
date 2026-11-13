import { AppShell } from '@/components/AppShell';
import { requireRole } from '@/lib/guard';

export default async function TechHome() {
  const me = await requireRole(['TECHNICIAN']);
  return (
    <AppShell me={me} nav={[{ href: '/tech', label: 'أجهزتي' }]}>
      <h1 className="text-2xl font-bold">أهلاً {me.full_name ?? ''}</h1>
      <p className="mt-2 text-slate-500">هنا هتظهر الأجهزة المسندة ليك بس.</p>
    </AppShell>
  );
}
