'use client';
import { useEffect, useState } from 'react';
import { arabicError } from '@kmr/shared';
import { ErrorBox, Field, Flash, Loading } from '@/components/ui';
import { useRpc } from '@/lib/hooks';
import { supabaseBrowser } from '@/lib/supabase/client';

interface S {
  branch_id: string; name: string; phone: string | null; whatsapp: string | null; address: string | null; map_url: string | null;
  default_eta_hours: number; delay_threshold_hours: number; approval_link_ttl_hours: number; default_warranty_days: number;
  receipt_terms: string; warranty_terms: string; tracking_base_url: string;
}

export function SettingsForm() {
  const { data, error, loading } = useRpc<S>('get_branch_settings', {}, 's');
  const [s, setS] = useState<S | null>(null);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setS(data); }, [data]);

  if (loading && !s) return <Loading />;
  if (!s) return <ErrorBox text={error} />;
  const set = <K extends keyof S>(k: K, v: S[K]) => setS({ ...s, [k]: v });

  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      const { data: d, error: err } = await supabaseBrowser().rpc('update_branch_settings', { p: s });
      setBusy(false);
      if (err) return setFlash({ ok: false, text: arabicError(err.message) });
      setS(d as S);
      setFlash({ ok: true, text: 'تم حفظ الإعدادات' });
    }}>
      <section className="card grid gap-3 sm:grid-cols-2">
        <h2 className="font-bold sm:col-span-2">بيانات المحل (بتظهر في الإيصال وصفحة المتابعة)</h2>
        <Field label="اسم الفرع"><input className="input" value={s.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="تليفون المحل"><input className="input text-left" dir="ltr" value={s.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="رقم واتساب المحل"><input className="input text-left" dir="ltr" value={s.whatsapp ?? ''} onChange={(e) => set('whatsapp', e.target.value)} /></Field>
        <Field label="العنوان"><input className="input" value={s.address ?? ''} onChange={(e) => set('address', e.target.value)} /></Field>
        <Field label="رابط الموقع على الخريطة"><input className="input text-left" dir="ltr" value={s.map_url ?? ''} onChange={(e) => set('map_url', e.target.value)} /></Field>
        <Field label="رابط موقع النظام" hint="مثال: https://khaled-repair.vercel.app — بيتبني منه رابط المتابعة والـ QR">
          <input className="input text-left" dir="ltr" value={s.tracking_base_url} onChange={(e) => set('tracking_base_url', e.target.value)} />
        </Field>
      </section>

      <section className="card grid gap-3 sm:grid-cols-2">
        <h2 className="font-bold sm:col-span-2">الافتراضيات</h2>
        <Field label="مدة الإصلاح المتوقعة (ساعة)"><input type="number" min={1} className="input" value={s.default_eta_hours} onChange={(e) => set('default_eta_hours', Number(e.target.value))} /></Field>
        <Field label="الضمان الافتراضي (يوم)"><input type="number" min={0} className="input" value={s.default_warranty_days} onChange={(e) => set('default_warranty_days', Number(e.target.value))} /></Field>
        <Field label="صلاحية رابط الموافقة (ساعة)"><input type="number" min={1} className="input" value={s.approval_link_ttl_hours} onChange={(e) => set('approval_link_ttl_hours', Number(e.target.value))} /></Field>
        <Field label="تنبيه التأخير بعد (ساعة من الموعد)"><input type="number" min={0} className="input" value={s.delay_threshold_hours} onChange={(e) => set('delay_threshold_hours', Number(e.target.value))} /></Field>
      </section>

      <section className="card space-y-3">
        <Field label="شروط الاستلام"><textarea className="input min-h-32 py-3" value={s.receipt_terms} onChange={(e) => set('receipt_terms', e.target.value)} /></Field>
        <Field label="شروط الضمان"><textarea className="input min-h-24 py-3" value={s.warranty_terms} onChange={(e) => set('warranty_terms', e.target.value)} /></Field>
      </section>

      <Flash msg={flash} />
      <button className="btn-primary w-full" disabled={busy}>{busy ? 'جاري الحفظ…' : 'حفظ الإعدادات'}</button>
    </form>
  );
}
