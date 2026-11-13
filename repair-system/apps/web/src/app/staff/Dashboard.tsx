'use client';
import Link from 'next/link';
import { ErrorBox, Loading } from '@/components/ui';
import { useLiveRefresh, useRpc } from '@/lib/hooks';

interface Stats {
  received_today: number;
  under_diagnosis: number;
  under_repair: number;
  waiting_customer: number;
  waiting_part: number;
  waiting_manager: number;
  ready: number;
  overdue: number;
  delivered_today: number;
  delivered_total: number;
  unassigned: number;
  in_shop: number;
  pending_bookings: number;
  today_appointments: number;
}

const CARDS: { key: keyof Stats; label: string; href: string; tone: string }[] = [
  { key: 'received_today', label: 'مستلمة اليوم', href: '/staff/orders?today=1', tone: 'border-brand' },
  { key: 'under_diagnosis', label: 'تحت الفحص', href: '/staff/orders?status=UNDER_DIAGNOSIS', tone: 'border-indigo-400' },
  { key: 'under_repair', label: 'تحت الصيانة', href: '/staff/orders?status=CUSTOMER_APPROVED,UNDER_REPAIR,UNDER_TESTING', tone: 'border-blue-400' },
  { key: 'waiting_customer', label: 'انتظار موافقة العميل', href: '/staff/orders?status=WAITING_CUSTOMER_APPROVAL', tone: 'border-amber-400' },
  { key: 'waiting_part', label: 'انتظار قطعة غيار', href: '/staff/orders?status=WAITING_SPARE_PART', tone: 'border-orange-400' },
  { key: 'waiting_manager', label: 'تنتظر اعتماد المدير', href: '/staff/orders?status=WAITING_MANAGER_APPROVAL', tone: 'border-yellow-400' },
  { key: 'ready', label: 'جاهزة للاستلام', href: '/staff/orders?status=READY_FOR_PICKUP', tone: 'border-emerald-500' },
  { key: 'overdue', label: 'متأخرة', href: '/staff/orders?overdue=1', tone: 'border-red-500' },
  { key: 'delivered_today', label: 'اتسلمت اليوم', href: '/staff/orders?status=DELIVERED', tone: 'border-green-600' },
];

export function Dashboard() {
  const { data, error, loading, reload } = useRpc<Stats>('staff_dashboard_stats', {}, 'stats');
  useLiveRefresh(['repair_orders', 'bookings'], reload);

  if (loading && !data) return <Loading />;
  return (
    <div className="space-y-6">
      <ErrorBox text={error} />
      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Link href="/staff/bookings" className="card flex items-center justify-between border-r-4 border-r-sky hover:shadow-md">
              <span className="font-bold">📅 حجوزات تنتظر التأكيد</span>
              <span className="text-2xl font-bold text-brand">{data.pending_bookings}</span>
            </Link>
            <Link href="/staff/bookings?tab=today" className="card flex items-center justify-between border-r-4 border-r-sky hover:shadow-md">
              <span className="font-bold">🕒 مواعيد النهارده</span>
              <span className="text-2xl font-bold text-brand">{data.today_appointments}</span>
            </Link>
            <Link href="/staff/orders?unassigned=1" className="card flex items-center justify-between border-r-4 border-r-slate-400 hover:shadow-md">
              <span className="font-bold">🧑‍🔧 أجهزة بدون فني</span>
              <span className="text-2xl font-bold text-brand">{data.unassigned}</span>
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
            {CARDS.map((c) => (
              <Link key={c.key} href={c.href} className={`card border-t-4 ${c.tone} hover:shadow-md`}>
                <div className="text-sm text-slate-500">{c.label}</div>
                <div className={`mt-2 text-3xl font-bold ${c.key === 'overdue' && data[c.key] > 0 ? 'text-red-600' : ''}`}>{data[c.key]}</div>
              </Link>
            ))}
          </div>

          <p className="text-sm text-slate-500">
            الأجهزة الموجودة في المحل دلوقتي: <b>{data.in_shop}</b> · إجمالي اللي اتسلّم: <b>{data.delivered_total}</b>
          </p>
        </>
      )}
    </div>
  );
}
