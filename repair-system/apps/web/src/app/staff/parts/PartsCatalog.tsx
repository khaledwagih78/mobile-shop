'use client';
import { useState } from 'react';
import { arabicError } from '@kmr/shared';
import { Dialog, ErrorBox, Field, Flash, Loading } from '@/components/ui';
import { money } from '@/lib/format';
import { useRpc } from '@/lib/hooks';
import { supabaseBrowser } from '@/lib/supabase/client';

interface Part { id: string; name: string; brand: string | null; part_number: string | null; compatible_models: string[]; default_price: number; is_active: boolean }
type Draft = Omit<Part, 'id' | 'compatible_models'> & { id?: string; models: string };

const empty: Draft = { name: '', brand: '', part_number: '', default_price: 0, is_active: true, models: '' };

/** كتالوج أسماء وأسعار القطع فقط — مفيش أرصدة مخزون في النسخة دي. */
export function PartsCatalog() {
  const [q, setQ] = useState('');
  const { data, error, loading, reload } = useRpc<Part[]>('search_spare_parts', { p_q: q, p_include_inactive: true }, q);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!edit) return;
    const { error: e } = await supabaseBrowser().rpc('upsert_spare_part', {
      p: { ...edit, compatible_models: edit.models.split(/[,،]/).map((x) => x.trim()).filter(Boolean) },
    });
    if (e) return setErr(arabicError(e.message));
    setEdit(null);
    setFlash({ ok: true, text: 'تم الحفظ' });
    reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input className="input" placeholder="بحث بالاسم أو الموديل" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn-primary whitespace-nowrap" onClick={() => { setErr(null); setEdit({ ...empty }); }}>➕ قطعة</button>
      </div>
      <p className="text-sm text-slate-500">السعر هنا افتراضي — المدير بيحدد السعر النهائي لكل جهاز وقت التسعير، وبيتسجل وقت الاستخدام.</p>
      <Flash msg={flash} />
      <ErrorBox text={error} />
      {loading && !data ? <Loading /> : (
        <div className="card divide-y p-0">
          {(data ?? []).length === 0 && <p className="p-4 text-slate-400">لا توجد قطع</p>}
          {(data ?? []).map((p) => (
            <button key={p.id} className={`flex w-full items-center justify-between p-4 text-right hover:bg-brand-50 ${p.is_active ? '' : 'opacity-50'}`}
              onClick={() => { setErr(null); setEdit({ ...p, brand: p.brand ?? '', part_number: p.part_number ?? '', models: p.compatible_models.join('، ') }); }}>
              <span>
                <b>{p.name}</b>{p.brand ? <span className="text-slate-400"> · {p.brand}</span> : null}{!p.is_active && ' (موقوفة)'}
                {p.compatible_models.length > 0 && <span className="block text-xs text-slate-400">{p.compatible_models.join('، ')}</span>}
              </span>
              <span className="font-bold">{money(p.default_price)}</span>
            </button>
          ))}
        </div>
      )}
      {edit && (
        <Dialog title={edit.id ? 'تعديل قطعة' : 'قطعة جديدة'} onClose={() => setEdit(null)}>
          <Field label="الاسم"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="الشركة"><input className="input" value={edit.brand ?? ''} onChange={(e) => setEdit({ ...edit, brand: e.target.value })} /></Field>
          <Field label="الموديلات المتوافقة" hint="افصل بينها بفاصلة"><input className="input" value={edit.models} onChange={(e) => setEdit({ ...edit, models: e.target.value })} /></Field>
          <Field label="كود القطعة"><input className="input" value={edit.part_number ?? ''} onChange={(e) => setEdit({ ...edit, part_number: e.target.value })} /></Field>
          <Field label="السعر الافتراضي"><input type="number" min={0} className="input" value={edit.default_price} onChange={(e) => setEdit({ ...edit, default_price: Number(e.target.value) || 0 })} /></Field>
          <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" className="h-5 w-5" checked={edit.is_active} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} /> متاحة للفنيين</label>
          <ErrorBox text={err} />
          <button className="btn-primary w-full" onClick={save}>حفظ</button>
        </Dialog>
      )}
    </div>
  );
}
