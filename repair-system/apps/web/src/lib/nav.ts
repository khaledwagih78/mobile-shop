import type { AppRole } from '@kmr/shared';
import type { NavItem } from '@/components/AppShell';

// القائمة بتظهر الشاشات الجاهزة فعلاً بس؛ كل مرحلة بتضيف شاشاتها هنا.
export function staffNav(role: AppRole): NavItem[] {
  const items: NavItem[] = [{ href: '/staff', label: 'الرئيسية' }];
  if (role === 'ADMIN') items.push({ href: '/admin/users', label: 'المستخدمين' });
  return items;
}
