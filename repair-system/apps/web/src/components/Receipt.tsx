import { DEVICE_TYPE_LABELS } from '@kmr/shared';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { Logo } from './Brand';

export interface ReceiptData {
  shop_name: string;
  branch: string;
  branch_phone: string | null;
  branch_address: string | null;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  device_type: keyof typeof DEVICE_TYPE_LABELS;
  brand: string;
  model: string;
  color: string | null;
  imei: string | null;
  intake_condition: string | null;
  intake_damages: { area: string; note?: string }[];
  accessories: string[];
  issue_description: string;
  received_at: string;
  expected_ready_at: string | null;
  warranty_days: number;
  tracking_url: string;
  receipt_terms: string;
  warranty_terms: string;
}

function Row({ k, v, ltr }: { k: string; v: React.ReactNode; ltr?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-dashed border-slate-200 py-2 text-sm">
      <span className="text-slate-500">{k}</span>
      <span className="text-left font-semibold" dir={ltr ? 'ltr' : undefined}>{v || '—'}</span>
    </div>
  );
}

/** الإيصال الإلكتروني (بدون طباعة) — صفحة قابلة للحفظ والمشاركة. */
export function Receipt({ r, qrSvg, trackingUrl }: { r: ReceiptData; qrSvg: string; trackingUrl: string }) {
  return (
    <article className="mx-auto max-w-md overflow-hidden rounded-2xl bg-white shadow-lg">
      <header className="bg-navy p-5 text-center text-white">
        <div className="flex justify-center"><Logo size={56} /></div>
        <h1 className="mt-2 text-xl font-bold">{r.shop_name}</h1>
        <p className="text-sm text-sky-100">إيصال استلام جهاز للصيانة</p>
      </header>

      <div className="p-5">
        <div className="rounded-xl bg-brand-50 p-4 text-center">
          <div className="text-xs text-slate-500">رقم طلب الصيانة</div>
          <div className="text-2xl font-bold tracking-wide text-brand-600" dir="ltr">{r.order_number}</div>
        </div>

        <div className="mt-4">
          <Row k="اسم العميل" v={r.customer_name} />
          <Row k="رقم الهاتف" v={r.customer_phone} ltr />
          <Row k="نوع الجهاز" v={DEVICE_TYPE_LABELS[r.device_type]} />
          <Row k="الموديل" v={`${r.brand} ${r.model}${r.color ? ` — ${r.color}` : ''}`} />
          {r.imei && <Row k="IMEI" v={r.imei} ltr />}
          <Row k="تاريخ الاستلام" v={fmtDateTime(r.received_at)} />
          <Row k="الموعد المتوقع" v={fmtDate(r.expected_ready_at)} />
          {r.warranty_days > 0 && <Row k="الضمان" v={`${r.warranty_days} يوم`} />}
        </div>

        <section className="mt-4">
          <h2 className="text-sm font-bold">وصف العطل</h2>
          <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{r.issue_description}</p>
        </section>

        <section className="mt-4">
          <h2 className="text-sm font-bold">حالة الجهاز عند الاستلام</h2>
          <p className="mt-1 text-sm text-slate-700">{r.intake_condition || '—'}</p>
          {r.intake_damages?.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-sm text-slate-700">
              {r.intake_damages.map((d, i) => <li key={i}>{d.area}{d.note ? `: ${d.note}` : ''}</li>)}
            </ul>
          )}
          {r.accessories?.length > 0 && <p className="mt-1 text-sm text-slate-700">المستلم مع الجهاز: {r.accessories.join('، ')}</p>}
        </section>

        <section className="mt-5 flex flex-col items-center gap-2 rounded-xl border border-slate-200 p-4">
          <div className="h-40 w-40" dangerouslySetInnerHTML={{ __html: qrSvg }} aria-label="QR متابعة الجهاز" />
          <p className="text-sm font-semibold">امسح الكود لمتابعة جهازك</p>
          <a href={trackingUrl} className="break-all text-center text-xs text-brand" dir="ltr">{trackingUrl}</a>
        </section>

        {(r.receipt_terms || r.warranty_terms) && (
          <section className="mt-5 space-y-2 text-xs leading-6 text-slate-500">
            {r.receipt_terms && <div><b className="text-navy">شروط الاستلام</b><p className="whitespace-pre-line">{r.receipt_terms}</p></div>}
            {r.warranty_terms && <div><b className="text-navy">الضمان</b><p className="whitespace-pre-line">{r.warranty_terms}</p></div>}
          </section>
        )}

        <footer className="mt-5 border-t pt-3 text-center text-xs text-slate-500">
          {r.branch}{r.branch_address ? ` — ${r.branch_address}` : ''}{r.branch_phone ? <> — <span dir="ltr">{r.branch_phone}</span></> : null}
        </footer>
      </div>
    </article>
  );
}
