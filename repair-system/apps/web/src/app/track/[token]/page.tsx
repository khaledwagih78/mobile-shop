import { notFound } from 'next/navigation';
import { STATUS_LABELS, waLink, type RepairStatus } from '@kmr/shared';
import { AutoRefresh } from '@/components/AutoRefresh';
import { Logo } from '@/components/Brand';
import { STATUS_STYLE, fmtDate, fmtDateTime, money } from '@/lib/format';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'متابعة الجهاز — خالد لصيانة المحمول', robots: { index: false, follow: false } };

interface Track {
  order_number: string | null;
  status: RepairStatus;
  status_label: string;
  device: string;
  received_at: string | null;
  expected_ready_at: string | null;
  approved_cost: number | null;
  pending_amount: number | null;
  diagnosis_summary: string | null;
  last_update_at: string;
  branch: { name: string; phone: string | null; whatsapp: string | null; address: string | null; map_url: string | null };
  timeline: { status: RepairStatus; label: string; note: string | null; at: string }[];
}

// المراحل الأساسية اللي بتظهر كخط زمني للعميل
const MAIN_STEPS: RepairStatus[] = ['DEVICE_RECEIVED', 'UNDER_DIAGNOSIS', 'WAITING_CUSTOMER_APPROVAL', 'UNDER_REPAIR', 'READY_FOR_PICKUP', 'DELIVERED'];
const STEP_OF: Partial<Record<RepairStatus, number>> = {
  NEW_REQUEST: -1, BOOKING_CONFIRMED: -1, DEVICE_RECEIVED: 0, UNDER_DIAGNOSIS: 1, WAITING_CUSTOMER_APPROVAL: 2,
  CUSTOMER_APPROVED: 3, CUSTOMER_REJECTED: 3, WAITING_SPARE_PART: 3, UNDER_REPAIR: 3, UNDER_TESTING: 3,
  WAITING_MANAGER_APPROVAL: 3, READY_FOR_PICKUP: 4, DELIVERED: 5,
};

// صفحة عامة بالرمز السري — بتعرض حالة الجهاز فقط (من غير أسماء فنيين أو ملاحظات داخلية).
export default async function TrackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{20,64}$/i.test(token)) notFound();
  const sb = await supabaseServer();
  const { data } = await sb.rpc('track_order', { p_token: token });
  if (!data) notFound();
  const t = data as Track;
  const step = STEP_OF[t.status] ?? -1;
  const wa = t.branch.whatsapp || t.branch.phone;

  return (
    <main className="min-h-screen bg-slate-100 pb-10">
      <AutoRefresh seconds={30} />
      <header className="bg-navy px-4 pb-16 pt-6 text-white">
        <div className="mx-auto flex max-w-md items-center gap-3"><Logo size={44} /><div className="font-bold">خالد لصيانة المحمول</div></div>
      </header>
      <div className="mx-auto -mt-12 max-w-md space-y-4 px-4">
        <section className="card text-center">
          <div className="text-xs text-slate-500">رقم طلب الصيانة</div>
          <div className="text-xl font-bold" dir="ltr">{t.order_number ?? '—'}</div>
          <div className="mt-1 text-slate-600">{t.device}</div>
          <div className={`badge mt-3 px-5 py-2 text-base ${STATUS_STYLE[t.status]}`}>{t.status_label}</div>
          <div className="mt-2 text-xs text-slate-400">آخر تحديث: {fmtDateTime(t.last_update_at)}</div>
        </section>

        {t.status !== 'CANCELLED' && (
          <section className="card">
            <ol className="space-y-3">
              {MAIN_STEPS.map((s, i) => (
                <li key={s} className="flex items-center gap-3">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                    i < step ? 'bg-brand text-white' : i === step ? 'bg-sky text-navy ring-4 ring-sky-100' : 'bg-slate-200 text-slate-400'}`}>
                    {i < step ? '✓' : i + 1}
                  </span>
                  <span className={i <= step ? 'font-bold' : 'text-slate-400'}>
                    {i === 3 ? 'تحت الصيانة' : STATUS_LABELS[s]}
                    {i === step && i === 3 && t.status !== 'UNDER_REPAIR' ? ` — ${t.status_label}` : ''}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="card space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-slate-500">تاريخ الاستلام</span><b>{fmtDate(t.received_at)}</b></div>
          <div className="flex justify-between"><span className="text-slate-500">الموعد المتوقع</span><b>{fmtDate(t.expected_ready_at)}</b></div>
          {t.approved_cost !== null && <div className="flex justify-between"><span className="text-slate-500">التكلفة المعتمدة</span><b>{money(t.approved_cost)}</b></div>}
          {t.pending_amount !== null && t.status === 'WAITING_CUSTOMER_APPROVAL' && (
            <div className="rounded-xl bg-amber-50 p-3 text-amber-800">
              التكلفة المقترحة <b>{money(t.pending_amount)}</b> في انتظار موافقتك — هيوصلك رابط الموافقة، أو كلّم المحل.
            </div>
          )}
          {t.diagnosis_summary && <div><span className="text-slate-500">تقرير الفحص:</span><p className="mt-1">{t.diagnosis_summary}</p></div>}
        </section>

        <section className="card">
          <h2 className="mb-3 font-bold">سجل الجهاز</h2>
          <ul className="space-y-3 border-r-2 border-slate-200 pr-4">
            {t.timeline.slice().reverse().map((e, i) => (
              <li key={i} className="relative">
                <span className="absolute -right-[23px] top-1.5 h-3 w-3 rounded-full bg-brand" />
                <div className="font-semibold">{e.label}</div>
                {e.note && <div className="text-sm text-slate-600">{e.note}</div>}
                <div className="text-xs text-slate-400">{fmtDateTime(e.at)}</div>
              </li>
            ))}
          </ul>
        </section>

        <section className="card space-y-2 text-sm">
          <h2 className="font-bold">{t.branch.name}</h2>
          {t.branch.address && <p className="text-slate-600">{t.branch.address}</p>}
          <div className="flex flex-wrap gap-2">
            {t.branch.phone && <a className="btn-secondary flex-1" href={`tel:${t.branch.phone}`}>📞 اتصال</a>}
            {wa && <a className="btn flex-1 bg-[#25D366] text-white" href={waLink(wa, `استفسار عن طلب ${t.order_number ?? ''}`)}>واتساب</a>}
            {t.branch.map_url && <a className="btn-secondary flex-1" href={t.branch.map_url}>📍 الموقع</a>}
          </div>
        </section>
      </div>
    </main>
  );
}
