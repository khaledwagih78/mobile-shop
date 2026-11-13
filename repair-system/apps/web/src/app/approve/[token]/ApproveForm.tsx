'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { arabicError } from '@kmr/shared';
import { ErrorBox } from '@/components/ui';
import { supabaseBrowser } from '@/lib/supabase/client';

export function ApproveForm({ token }: { token: string }) {
  const router = useRouter();
  const [last4, setLast4] = useState('');
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(approve: boolean) {
    setBusy(true);
    const { error: e } = await supabaseBrowser().rpc('respond_quote_by_token', {
      p_token: token, p_phone_last4: last4, p_approve: approve, p_note: note.trim() || null,
    });
    setBusy(false);
    if (e) { setConfirm(null); return setError(arabicError(e.message)); }
    router.refresh();
  }

  return (
    <div className="card space-y-3">
      <label className="block">
        <span className="label">للتأكيد: اكتب آخر 4 أرقام من رقم موبايلك المسجّل في المحل</span>
        <input className="input text-center text-2xl tracking-[0.4em]" dir="ltr" inputMode="numeric" maxLength={4}
          value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, ''))} />
      </label>
      <label className="block">
        <span className="label">ملاحظة (اختياري)</span>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <ErrorBox text={error} />
      {confirm === null ? (
        <div className="grid grid-cols-2 gap-2">
          <button className="btn bg-emerald-600 text-white" disabled={last4.length !== 4 || busy} onClick={() => setConfirm(true)}>✅ موافق</button>
          <button className="btn bg-rose-600 text-white" disabled={last4.length !== 4 || busy} onClick={() => setConfirm(false)}>✖ رفض</button>
        </div>
      ) : (
        <div className="space-y-2 rounded-xl bg-slate-50 p-3 text-center">
          <p className="font-bold">{confirm ? 'متأكد إنك موافق على التكلفة وبدء الإصلاح؟' : 'متأكد إنك رافض الإصلاح؟ هتستلم جهازك من غير إصلاح.'}</p>
          <div className="grid grid-cols-2 gap-2">
            <button className={`btn ${confirm ? 'bg-emerald-600' : 'bg-rose-600'} text-white`} disabled={busy} onClick={() => send(confirm)}>{busy ? '…' : 'تأكيد'}</button>
            <button className="btn-secondary" onClick={() => setConfirm(null)}>رجوع</button>
          </div>
        </div>
      )}
    </div>
  );
}
