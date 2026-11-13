import { notFound } from 'next/navigation';
import { Receipt, type ReceiptData } from '@/components/Receipt';
import { ShareButtons } from '@/components/ShareButtons';
import { qrSvg } from '@/lib/qr';
import { absolute } from '@/lib/site';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'إيصال استلام — خالد لصيانة المحمول', robots: { index: false, follow: false } };

// صفحة عامة (من غير تسجيل دخول): الرمز السري في الرابط هو الصلاحية، والبيانات الحساسة متخفية جزئيًا.
export default async function PublicReceipt({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{20,64}$/i.test(token)) notFound();
  const sb = await supabaseServer();
  const { data } = await sb.rpc('get_receipt', { p_token: token });
  if (!data) notFound();
  const r = data as ReceiptData;
  const url = await absolute(r.tracking_url);
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8">
      <Receipt r={r} qrSvg={await qrSvg(url)} trackingUrl={url} />
      <div className="mx-auto mt-4 max-w-md space-y-3 text-center">
        <ShareButtons url={url} title={`إيصال ${r.order_number}`} />
        <a href={url} className="btn-primary w-full">متابعة حالة الجهاز</a>
        <p className="text-xs text-slate-500">احتفظ بالرابط ده — هو إثبات استلام جهازك.</p>
      </div>
    </main>
  );
}
