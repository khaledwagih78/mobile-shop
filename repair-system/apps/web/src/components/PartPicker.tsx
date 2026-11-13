'use client';
import { useState } from 'react';
import { useRpc } from '@/lib/hooks';

export interface PickedPart {
  spare_part_id: string | null;
  part_name: string;
  qty: number;
}

interface CatalogRow { id: string; name: string; brand: string | null; compatible_models: string[] }

/** بحث في كتالوج قطع الغيار أو كتابة اسم قطعة مش موجودة. */
export function PartPicker({ onPick, hint }: { onPick: (p: PickedPart) => void; hint?: string }) {
  const [q, setQ] = useState('');
  const [qty, setQty] = useState(1);
  const { data } = useRpc<CatalogRow[]>('search_spare_parts', { p_q: q }, q);
  const pick = (p: Omit<PickedPart, 'qty'>) => { onPick({ ...p, qty }); setQ(''); setQty(1); };

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 p-3">
      <div className="flex gap-2">
        <input className="input" placeholder={hint ?? 'ابحث عن قطعة (اسم، موديل)…'} value={q} onChange={(e) => setQ(e.target.value)} />
        <input type="number" min={1} className="input w-20 text-center" value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} aria-label="الكمية" />
      </div>
      {q.trim().length >= 2 && (
        <div className="divide-y rounded-lg border border-slate-100">
          {(data ?? []).slice(0, 8).map((r) => (
            <button type="button" key={r.id} className="block w-full p-2 text-right text-sm hover:bg-brand-50"
              onClick={() => pick({ spare_part_id: r.id, part_name: r.name })}>
              <b>{r.name}</b> {r.brand ? <span className="text-slate-400">· {r.brand}</span> : null}
              {r.compatible_models.length > 0 && <span className="block text-xs text-slate-400">{r.compatible_models.join('، ')}</span>}
            </button>
          ))}
          <button type="button" className="block w-full p-2 text-right text-sm font-semibold text-brand hover:bg-brand-50"
            onClick={() => pick({ spare_part_id: null, part_name: q.trim() })}>
            ➕ إضافة "{q.trim()}" (مش في الكتالوج)
          </button>
        </div>
      )}
    </div>
  );
}
