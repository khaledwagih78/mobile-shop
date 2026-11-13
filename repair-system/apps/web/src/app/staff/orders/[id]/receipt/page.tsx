import Link from 'next/link';
import { notFound } from 'next/navigation';
import { receiptUrl, receivedMessage, waLink } from '@kmr/shared';
import { AppShell } from '@/components/AppShell';
import { Receipt, type ReceiptData } from '@/components/Receipt';
import { ShareButtons } from '@/components/ShareButtons';
import { requireRole } from '@/lib/guard';
import { FRONT_OFFICE, staffNav } from '@/lib/nav';
import { qrSvg } from '@/lib/qr';
import { absolute, siteBase } from '@/lib/site';
import { supabaseServer } from '@/lib/supabase/server';

export const metadata = { title: 'الإيصال — خالد لصيانة المحمول' };

export default async function StaffReceipt({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ new?: string; photos_failed?: string }>;
}) {
  const me = await requireRole(FRONT_OFFICE);
  const { id } = await params;
  const sp = await searchParams;
  const sb = await supabaseServer();
  const { data: share } = await sb.rpc('staff_receipt_share', { p_order: id });
  if (!share?.tracking_token) notFound();
  const { data } = await sb.rpc('get_receipt', { p_token: share.tracking_token });
  if (!data) notFound();
  const r = data as ReceiptData;
  const trackUrl = await absolute(r.tracking_url);
  const recUrl = receiptUrl(await siteBase(share.tracking_base_url), share.tracking_token);
  const wa = waLink(share.customer_phone, `${receivedMessage(r.order_number, trackUrl)}\n\nالإيصال الإلكتروني:\n${recUrl}`);

  return (
    <AppShell me={me} nav={staffNav(me.role)}>
      {sp.new && (
        <div className="mx-auto mb-4 max-w-md rounded-xl bg-emerald-50 p-4 text-center font-bold text-emerald-700">
          ✔ تم استلام الجهاز — رقم الطلب <span dir="ltr">{r.order_number}</span>
        </div>
      )}
      {sp.photos_failed && (
        <div className="mx-auto mb-4 max-w-md rounded-xl bg-amber-50 p-3 text-center text-sm font-semibold text-amber-800">
          {sp.photos_failed} صورة ما اترفعتش — ضيفها من صفحة تفاصيل الجهاز.
        </div>
      )}
      <div className="mx-auto mb-4 flex max-w-md flex-col gap-2">
        <a href={wa} target="_blank" rel="noopener noreferrer" className="btn w-full bg-[#25D366] text-white hover:opacity-90">
          🟢 إرسال الإيصال للعميل على واتساب
        </a>
        <ShareButtons url={recUrl} title={`إيصال ${r.order_number}`} />
        <Link href={`/staff/orders/${id}`} className="btn-secondary w-full">تفاصيل الجهاز وتعيين فني</Link>
      </div>
      <Receipt r={r} qrSvg={await qrSvg(trackUrl)} trackingUrl={trackUrl} />
    </AppShell>
  );
}
