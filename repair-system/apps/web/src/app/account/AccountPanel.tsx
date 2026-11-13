'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { arabicError, displayPhone } from '@kmr/shared';
import { supabaseBrowser } from '@/lib/supabase/client';

interface Customer {
  id: string;
  full_name: string;
  phone: string;
  verified: boolean;
}

/** يقبل الرابط كامل (…/track/<token> أو …/receipt/<token>) أو الرمز لوحده. */
export function extractToken(input: string): string {
  const t = input.trim();
  const m = /\/(?:track|receipt)\/([0-9a-f]{20,})/i.exec(t);
  return (m ? m[1] : t).toLowerCase();
}

export function AccountPanel({ customer, phone }: { customer: Customer | null; phone: string | null }) {
  const router = useRouter();
  const sb = supabaseBrowser();
  const [name, setName] = useState(customer?.full_name ?? '');
  const [link, setLink] = useState('');
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await sb.rpc('update_my_customer', { p_full_name: name });
    setBusy(false);
    setFlash(error ? { ok: false, text: arabicError(error.message) } : { ok: true, text: 'تم حفظ الاسم' });
    router.refresh();
  }

  async function claim(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await sb.rpc('claim_customer_record', { p_tracking_token: extractToken(link) });
    setBusy(false);
    setFlash(error ? { ok: false, text: arabicError(error.message) } : { ok: true, text: 'تم ربط حسابك بأجهزتك في المحل ✔' });
    if (!error) router.refresh();
  }

  return (
    <div className="space-y-4">
      {flash && (
        <p role="status" className={`rounded-xl p-3 text-sm font-semibold ${flash.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
          {flash.text}
        </p>
      )}

      <div className="card">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">بياناتي</h2>
          {customer && (
            <span className={`badge ${customer.verified ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
              {customer.verified ? 'حساب موثّق' : 'غير موثّق'}
            </span>
          )}
        </div>
        <p className="mt-2 text-sm text-slate-500" dir="ltr">{displayPhone(phone)}</p>
        {customer && (
          <form onSubmit={saveName} className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} aria-label="الاسم" />
            <button className="btn-primary sm:w-40" disabled={busy}>حفظ</button>
          </form>
        )}
      </div>

      {(!customer || !customer.verified) && (
        <div className="card">
          <h2 className="text-lg font-bold">عندك جهاز في المحل؟</h2>
          <p className="mt-1 text-sm text-slate-500">
            {customer
              ? 'حسابك هيتوثّق تلقائيًا أول ما تسلّم جهاز في المحل، أو الصق رابط إيصال الاستلام هنا.'
              : 'رقمك مسجّل عندنا في المحل. علشان نتأكد إنه رقمك، الصق رابط إيصال الاستلام اللي وصلك (أو امسح الـ QR وانسخ الرابط).'}
          </p>
          <form onSubmit={claim} className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input className="input text-left" dir="ltr" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…/track/…" />
            <button className="btn-primary sm:w-40" disabled={busy || link.trim().length < 20}>ربط</button>
          </form>
        </div>
      )}
    </div>
  );
}
