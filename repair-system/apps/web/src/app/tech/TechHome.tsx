'use client';
import Link from 'next/link';
import { DEVICE_TYPE_LABELS, type RepairStatus } from '@kmr/shared';
import { ErrorBox, Loading, StatusBadge } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import { useLiveRefresh, useRpc } from '@/lib/hooks';

interface Row {
  id: string; order_number: string | null; status: RepairStatus; device_type: keyof typeof DEVICE_TYPE_LABELS;
  brand: string; model: string; color: string | null; issue_description: string; assigned_at: string;
  accepted_at: string | null; expected_ready_at: string | null; is_overdue: boolean;
}

const WAITING: RepairStatus[] = ['WAITING_CUSTOMER_APPROVAL', 'WAITING_SPARE_PART', 'WAITING_MANAGER_APPROVAL', 'CUSTOMER_REJECTED', 'READY_FOR_PICKUP'];

export function TechHome() {
  const { data, error, loading, reload } = useRpc<Row[]>('tech_my_orders', {}, 'mine');
  useLiveRefresh(['technician_assignments', 'repair_orders'], reload);
  if (loading && !data) return <Loading />;
  const rows = data ?? [];
  const groups = [
    { title: '🆕 أجهزة جديدة — استلمها', rows: rows.filter((r) => !r.accepted_at) },
    { title: '🔧 شغّال عليها', rows: rows.filter((r) => r.accepted_at && !WAITING.includes(r.status)) },
    { title: '⏳ في الانتظار', rows: rows.filter((r) => r.accepted_at && WAITING.includes(r.status)) },
  ];

  return (
    <div className="space-y-6">
      <ErrorBox text={error} />
      {rows.length === 0 && <div className="card text-center text-slate-500">مفيش أجهزة مسندة ليك دلوقتي 👌</div>}
      {groups.filter((g) => g.rows.length).map((g) => (
        <section key={g.title} className="space-y-3">
          <h2 className="font-bold">{g.title} ({g.rows.length})</h2>
          {g.rows.map((r) => (
            <Link key={r.id} href={`/tech/orders/${r.id}`}
              className={`card block space-y-2 ${!r.accepted_at ? 'border-2 border-brand' : ''} ${r.is_overdue ? 'border-r-4 border-r-red-500' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold" dir="ltr">{r.order_number}</span>
                <StatusBadge status={r.status} />
              </div>
              <div className="text-lg font-bold">{r.brand} {r.model} <span className="text-sm font-normal text-slate-500">{DEVICE_TYPE_LABELS[r.device_type]}{r.color ? ` · ${r.color}` : ''}</span></div>
              <p className="line-clamp-2 text-sm text-slate-600">{r.issue_description}</p>
              <div className={`text-xs ${r.is_overdue ? 'font-bold text-red-600' : 'text-slate-500'}`}>
                {r.is_overdue ? '⚠️ متأخر — ' : ''}الموعد: {fmtDateTime(r.expected_ready_at)}
              </div>
            </Link>
          ))}
        </section>
      ))}
    </div>
  );
}
