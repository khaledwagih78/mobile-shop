import type { AppRole } from '@kmr/shared';
import type { NavItem } from '@/components/AppShell';

// القائمة بتظهر الشاشات الجاهزة فعلاً بس؛ كل مرحلة بتضيف شاشاتها هنا.
export function staffNav(role: AppRole): NavItem[] {
  const items: NavItem[] = [
    { href: '/staff', label: '📊 الرئيسية' },
    { href: '/staff/intake', label: '📥 استلام جهاز' },
    { href: '/staff/bookings', label: '📅 الحجوزات' },
    { href: '/staff/orders', label: '📱 كل الأجهزة' },
    { href: '/staff/orders?status=WAITING_MANAGER_APPROVAL', label: '✅ للاعتماد' },
    { href: '/staff/orders?status=READY_FOR_PICKUP', label: '🤝 للتسليم' },
  ];
  if (role === 'ADMIN' || role === 'MANAGER') {
    items.push({ href: '/staff/parts', label: '🔩 قطع الغيار' });
    items.push({ href: '/tech', label: '🔧 أجهزتي كفني' });
  }
  if (role === 'ADMIN' || role === 'MANAGER') items.push({ href: '/staff/settings', label: '⚙️ إعدادات المحل' });
  if (role === 'ADMIN') items.push({ href: '/admin/users', label: '👥 المستخدمين' });
  return items;
}

export const FRONT_OFFICE: AppRole[] = ['ADMIN', 'MANAGER', 'RECEPTIONIST'];
