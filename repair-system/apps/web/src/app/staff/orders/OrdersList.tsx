'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { DEVICE_TYPE_LABELS, REPAIR_STATUSES, STATUS_LABELS, displayPhone, type RepairStatus } from '@kmr/shared';
import { ErrorBox, Loading, StatusBadge } from '@/components/ui';
import { durationLabel, fmtDate, toLocalInput } from '@/lib/format';
import { useLiveRefresh, useRpc } from '@/lib/hooks';

interface OrderRow {
  id: string;
  order_number: string | null;
  status: RepairStatus;
  customer_name: string;
  customer_phone: string;
  device_type: keyof typeof DEVICE_TYPE_LABELS;
  brand: string;
  model: string;
  issue_description: string;
  technician_name: string | null;
  received_at: string | null;
  expected_ready_at: string | null;
  is_overdue: boolean;
  hours_in_shop: string | null;
}

interface Tech { employee_id: string; full_name: string }

const STATUS_GROUPS: { label: string; value: string }[] = [
  { label: 'كل الحالات', value: '' },
  { label: 'داخل المحل (لم يُسلّم)', value: 'DEVICE_RECEIVED,UNDER_DIAGNOSIS,WAITING_CUSTOMER_APPROVAL,CUSTOMER_APPROVED,CUSTOMER_REJECTED,WAITING_SPARE_PART,UNDER_REPAIR,UNDER_TESTING,WAITING_MANAGER_APPROVAL,READY_FOR_PICKUP' },
  { label: 'تحت الصيانة', value: 'CUSTOMER_APPROVED,UNDER_REPAIR,UNDER_TESTING' },
  ...REPAIR_STATUSES.map((s) => ({ label: STATUS_LABELS[s], value: s })),
];

export function OrdersList() {
  const router = useRouter();
  const sp = useSearchParams();
  const today = toLocalInput(null).slice(0, 10);

  const [search, setSearch] = useState(sp.get('q') ?? '');
  const [status, setStatus] = useState(sp.get('status') ?? '');
  const [tech, setTech] = useState(sp.get('tech') ?? '');
  const [deviceType, setDeviceType] = useState(sp.get('type') ?? '');
  const [from, setFrom] = useState(sp.get('today') ? today : sp.get('from') ?? '');
  const [to, setTo] = useState(sp.get('today') ? today : sp.get('to') ?? '');
  const [overdue, setOverdue] = useState(sp.get('overdue') === '1');
  const [unassigned, setUnassigned] = useState(sp.get('unassigned') === '1');

  const args = useMemo(() => ({
    p_statuses: status ? status.split(',') : null,
    p_search: search.trim() || null,
    p_technician: tech || null,
    p_device_type: deviceType || null,
    p_from: from || null,
    p_to: to || null,
    p_overdue_only: overdue,
    p_unassigned_only: unassigned,
    p_limit: 200,
  }), [status, search, tech, deviceType, from, to, overdue, unassigned]);

  const { data, error, loading, reload } = useRpc<OrderRow[]>('staff_list_orders', args, JSON.stringify(args));
  const techs = useRpc<Tech[]>('staff_list_technicians', {}, 'techs');
  useLiveRefresh(['repair_orders'], reload);

  function clear() {
    setSearch(''); setStatus(''); setTech(''); setDeviceType(''); setFrom(''); setTo(''); setOverdue(false); setUnassigned(false);
    router.replace('/staff/orders');
  }

  return (
    <div className="space-y-4">
      <div className="card grid gap-3 md:grid-cols-4">
        <input className="input md:col-span-2" placeholder="بحث: رقم الطلب، اسم العميل، الموبايل، IMEI، الموديل"
          value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="الحالة">
          {STATUS_GROUPS.map((g) => <option key={g.label} value={g.value}>{g.label}</option>)}
        </select>
        <select className="input" value={tech} onChange={(e) => setTech(e.target.value)} aria-label="الفني">
          <option value="">كل الفنيين</option>
          {(techs.data ?? []).map((t) => <option key={t.employee_id} value={t.employee_id}>{t.full_name}</option>)}
        </select>
        <select className="input" value={deviceType} onChange={(e) => setDeviceType(e.target.value)} aria-label="نوع الجهاز">
          <option value="">كل الأجهزة</option>
          {Object.entries(DEVICE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className="flex items-center gap-2"><span className="text-sm text-slate-500">من</span>
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="flex items-center gap-2"><span className="text-sm text-slate-500">إلى</span>
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" className="h-5 w-5" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} /> المتأخرة
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" className="h-5 w-5" checked={unassigned} onChange={(e) => setUnassigned(e.target.checked)} /> بدون فني
          </label>
          <button className="text-sm font-semibold text-brand" onClick={clear}>مسح الفلاتر</button>
        </div>
      </div>

      <ErrorBox text={error} />
      {loading && !data ? <Loading /> : (
        <>
          <p className="text-sm text-slate-500">{data?.length ?? 0} جهاز</p>
          {/* موبايل: كروت — كمبيوتر: جدول */}
          <div className="space-y-3 md:hidden">
            {(data ?? []).map((o) => (
              <Link key={o.id} href={`/staff/orders/${o.id}`} className="card block space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold" dir="ltr">{o.order_number ?? 'حجز'}</span>
                  <StatusBadge status={o.status} />
                </div>
                <div className="font-semibold">{o.brand} {o.model} · <span className="text-slate-500">{o.customer_name}</span></div>
                <div className="line-clamp-1 text-sm text-slate-500">{o.issue_description}</div>
                <div className="flex justify-between text-xs text-slate-500">
                  <span>{o.technician_name ?? 'بدون فني'}</span>
                  <span className={o.is_overdue ? 'font-bold text-red-600' : ''}>{o.is_overdue ? '⚠️ متأخر · ' : ''}{durationLabel(o.hours_in_shop)}</span>
                </div>
              </Link>
            ))}
          </div>
          <div className="card hidden overflow-x-auto p-0 md:block">
            <table className="w-full min-w-[1000px] text-right text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  {['رقم الطلب', 'العميل', 'الجهاز', 'العطل', 'الحالة', 'الفني', 'الاستلام', 'موعد الانتهاء', 'في المحل من'].map((h) => (
                    <th key={h} className="p-3 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data ?? []).length === 0 && <tr><td colSpan={9} className="p-6 text-center text-slate-400">لا توجد أجهزة</td></tr>}
                {(data ?? []).map((o) => (
                  <tr key={o.id} className={`cursor-pointer border-t border-slate-100 hover:bg-brand-50 ${o.is_overdue ? 'bg-red-50/40' : ''}`}
                    onClick={() => router.push(`/staff/orders/${o.id}`)}>
                    <td className="p-3 font-bold" dir="ltr">{o.order_number ?? '—'}</td>
                    <td className="p-3">{o.customer_name}<span className="block text-xs text-slate-400" dir="ltr">{displayPhone(o.customer_phone)}</span></td>
                    <td className="p-3">{o.brand} {o.model}<span className="block text-xs text-slate-400">{DEVICE_TYPE_LABELS[o.device_type]}</span></td>
                    <td className="max-w-[220px] truncate p-3" title={o.issue_description}>{o.issue_description}</td>
                    <td className="p-3"><StatusBadge status={o.status} /></td>
                    <td className="p-3">{o.technician_name ?? <span className="text-slate-400">—</span>}</td>
                    <td className="p-3">{fmtDate(o.received_at)}</td>
                    <td className={`p-3 ${o.is_overdue ? 'font-bold text-red-600' : ''}`}>{fmtDate(o.expected_ready_at)}{o.is_overdue ? ' ⚠️' : ''}</td>
                    <td className="p-3">{durationLabel(o.hours_in_shop)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
