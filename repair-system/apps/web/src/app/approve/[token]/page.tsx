import { notFound } from 'next/navigation';
import { Logo } from '@/components/Brand';
import { fmtDateTime, money } from '@/lib/format';
import { supabaseServer } from '@/lib/supabase/server';
import { ApproveForm } from './ApproveForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'الموافقة على الإصلاح — خالد لصيانة المحمول', robots: { index: false, follow: false } };

interface Quote {
  order_number: string;
  device: string;
  amount: number;
  details: string;
  parts: { name: string; qty: number; unit_price: number }[];
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED' | 'EXPIRED';
  expired: boolean;
  expires_at: string;
}

// رابط آمن من واتساب: رمز عشوائي بصلاحية محددة + آخر 4 أرقام من الموبايل كتحقق إضافي.
export default async function ApprovePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{40,64}$/i.test(token)) notFound();
  const sb = await supabaseServer();
  const { data } = await sb.rpc('get_quote_by_token', { p_token: token });
  if (!data) notFound();
  const q = data as Quote;

  const closed =
    q.status === 'APPROVED' ? { tone: 'bg-emerald-50 text-emerald-800', text: '✅ تم تسجيل موافقتك — هنبدأ الإصلاح ونبلغك بكل مرحلة.' }
    : q.status === 'REJECTED' ? { tone: 'bg-rose-50 text-rose-800', text: 'تم تسجيل رفضك للإصلاح — هنبلغك لما الجهاز يبقى جاهز للاستلام.' }
    : q.status === 'SUPERSEDED' ? { tone: 'bg-amber-50 text-amber-800', text: 'العرض ده اتغيّر — هيوصلك رابط بالعرض الجديد.' }
    : q.expired ? { tone: 'bg-amber-50 text-amber-800', text: 'انتهت صلاحية الرابط — تواصل مع المحل.' }
    : null;

  return (
    <main className="min-h-screen bg-slate-100 pb-10">
      <header className="bg-navy px-4 pb-16 pt-6 text-white">
        <div className="mx-auto flex max-w-md items-center gap-3"><Logo size={44} /><div className="font-bold">خالد لصيانة المحمول</div></div>
      </header>
      <div className="mx-auto -mt-12 max-w-md space-y-4 px-4">
        <section className="card space-y-3">
          <div className="text-center">
            <div className="text-xs text-slate-500">طلب رقم</div>
            <div className="text-xl font-bold" dir="ltr">{q.order_number}</div>
            <div className="text-slate-600">{q.device}</div>
          </div>
          <div>
            <h2 className="font-bold">تقرير الفحص</h2>
            <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{q.details}</p>
          </div>
          {q.parts.length > 0 && (
            <div className="text-sm">
              <h2 className="font-bold">قطع الغيار</h2>
              {q.parts.map((p, i) => (
                <div key={i} className="flex justify-between border-b border-dashed border-slate-200 py-1">
                  <span>{p.name} × {p.qty}</span><span>{money(p.unit_price * p.qty)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between rounded-xl bg-brand-50 p-4">
            <span className="font-bold">التكلفة الإجمالية</span>
            <span className="text-2xl font-bold text-brand-600">{money(q.amount)}</span>
          </div>
          {!closed && <p className="text-center text-xs text-slate-500">الرابط صالح لحد {fmtDateTime(q.expires_at)}</p>}
        </section>
        {closed ? <div className={`card text-center font-bold ${closed.tone}`}>{closed.text}</div> : <ApproveForm token={token} />}
      </div>
    </main>
  );
}
