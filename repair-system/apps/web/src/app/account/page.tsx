import { AppShell } from '@/components/AppShell';
import { requireRole } from '@/lib/guard';
import { AccountPanel } from './AccountPanel';

export const metadata = { title: 'حسابي — خالد لصيانة المحمول' };

export default async function AccountPage() {
  const me = await requireRole(['CUSTOMER']);
  return (
    <AppShell me={me} nav={[{ href: '/account', label: 'حسابي' }]}>
      <h1 className="mb-4 text-2xl font-bold">حسابي</h1>
      <AccountPanel customer={me.customer} phone={me.phone} email={me.email} />
    </AppShell>
  );
}
