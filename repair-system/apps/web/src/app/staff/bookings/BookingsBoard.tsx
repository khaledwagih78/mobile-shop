'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { BOOKING_STATUS_LABELS, arabicError, displayPhone, waLink } from '@kmr/shared';
import { Dialog, ErrorBox, Field, Flash, Loading } from '@/components/ui';
import { fmtDateTime, fromLocalInput, toLocalInput } from '@/lib/format';
import { useLiveRefresh, useRpc } from '@/lib/hooks';
import { supabaseBrowser } from '@/lib/supabase/client';

interface Booking {
  id: string; status: string; repair_order_id: string; customer_name: string; customer_phone: string;
  brand: string; model: string; issue_description: string; preferred_at: string; proposed_at: string | null;
  confirmed_at: string | null; reject_reason: string | null; staff_note: string | null; created_at: string;
}

const TABS = [
  { key: 'pending', label: 'تنتظر التأكيد', statuses: ['PENDING', 'RESCHEDULE_PROPOSED'] },
  { key: 'today', label: 'مواعيد النهارده', statuses: ['CONFIRMED'], today: true },
  { key: 'confirmed', label: 'كل المؤكدة', statuses: ['CONFIRMED'] },
  { key: 'closed', label: 'المغلقة', statuses: ['CHECKED_IN', 'REJECTED', 'CANCELLED'] },
] as const;

type Action = { kind: 'confirm' | 'propose' | 'reject'; b: Booking } | null;

export function BookingsBoard() {
  const sp = useSearchParams();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>((sp.get('tab') as 'pending') ?? 'pending');
  const [search, setSearch] = useState('');
  const t = TABS.find((x) => x.key === tab)!;
  const args = useMemo(() => ({
    p_statuses: t.statuses,
    p_search: search.trim() || null,
    p_day: 'today' in t && t.today ? toLocalInput(null).slice(0, 10) : null,
  }), [t, search]);
  const { data, error, loading, reload } = useRpc<Booking[]>('staff_list_bookings', args, JSON.stringify(args));
  useLiveRefresh(['bookings'], reload);
  const [action, setAction] = useState<Action>(null);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto">
        {TABS.map((x) => (
          <button key={x.key} onClick={() => setTab(x.key)}
            className={`badge whitespace-nowrap px-4 py-2 text-sm ${tab === x.key ? 'bg-brand text-white' : 'bg-white text-navy'}`}>{x.label}</button>
        ))}
      </div>
      <input className="input" placeholder="بحث باسم العميل أو رقم الموبايل" value={search} onChange={(e) => setSearch(e.target.value)} />
      <Flash msg={flash} />
      <ErrorBox text={error} />
      {loading && !data ? <Loading /> : (
        <div className="grid gap-3 md:grid-cols-2">
          {(data ?? []).length === 0 && <p className="text-slate-400">لا توجد حجوزات</p>}
          {(data ?? []).map((b) => (
            <div key={b.id} className="card space-y-2">
              <div className="flex items-center justify-between">
                <b>{b.customer_name}</b>
                <span className="badge bg-sky-100 text-navy">{BOOKING_STATUS_LABELS[b.status] ?? b.status}</span>
              </div>
              <div className="text-sm text-slate-500" dir="ltr">{displayPhone(b.customer_phone)}</div>
              <div className="font-semibold">{b.brand} {b.model}</div>
              <p className="text-sm">{b.issue_description}</p>
              <div className="text-sm">
                🕒 {b.confirmed_at ? <>المؤكد: <b>{fmtDateTime(b.confirmed_at)}</b></>
                  : b.proposed_at ? <>مقترح من المحل: <b>{fmtDateTime(b.proposed_at)}</b></>
                  : <>طلب العميل: <b>{fmtDateTime(b.preferred_at)}</b></>}
              </div>
              {b.reject_reason && <p className="text-sm text-red-700">السبب: {b.reject_reason}</p>}
              <div className="flex flex-wrap gap-2 pt-1">
                {['PENDING', 'RESCHEDULE_PROPOSED', 'CONFIRMED'].includes(b.status) && (
                  <Link href={`/staff/intake?booking=${b.id}`} className="btn-primary min-h-10 px-4 text-sm">📥 العميل وصل — استلام</Link>
                )}
                {['PENDING', 'RESCHEDULE_PROPOSED'].includes(b.status) && (
                  <button className="btn-secondary min-h-10 px-4 text-sm" onClick={() => setAction({ kind: 'confirm', b })}>✔ تأكيد</button>
                )}
                {['PENDING', 'RESCHEDULE_PROPOSED'].includes(b.status) && (
                  <button className="btn-secondary min-h-10 px-4 text-sm" onClick={() => setAction({ kind: 'propose', b })}>🕒 موعد آخر</button>
                )}
                {['PENDING', 'RESCHEDULE_PROPOSED', 'CONFIRMED'].includes(b.status) && (
                  <button className="btn-danger min-h-10 px-4 text-sm" onClick={() => setAction({ kind: 'reject', b })}>رفض</button>
                )}
                <a className="btn min-h-10 bg-[#25D366] px-4 text-sm text-white" target="_blank" rel="noopener noreferrer"
                  href={waLink(b.customer_phone, `خالد لصيانة المحمول — بخصوص حجز صيانة ${b.brand} ${b.model}`)}>واتساب</a>
              </div>
            </div>
          ))}
        </div>
      )}
      {action && <ActionDialog action={action} onClose={() => setAction(null)}
        onDone={(text) => { setAction(null); setFlash({ ok: true, text }); reload(); }} />}
    </div>
  );
}

function ActionDialog({ action, onClose, onDone }: { action: NonNullable<Action>; onClose: () => void; onDone: (t: string) => void }) {
  const { kind, b } = action;
  const [when, setWhen] = useState(toLocalInput(b.proposed_at ?? b.preferred_at));
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const title = kind === 'confirm' ? 'تأكيد الحجز' : kind === 'propose' ? 'اقتراح موعد آخر' : 'رفض الحجز';

  async function go() {
    setBusy(true);
    const sb = supabaseBrowser();
    const r = kind === 'confirm'
      ? await sb.rpc('confirm_booking', { p_booking: b.id, p_confirmed_at: fromLocalInput(when), p_note: text || null })
      : kind === 'propose'
        ? await sb.rpc('propose_booking_time', { p_booking: b.id, p_proposed_at: fromLocalInput(when), p_note: text || null })
        : await sb.rpc('reject_booking', { p_booking: b.id, p_reason: text });
    setBusy(false);
    if (r.error) return setError(arabicError(r.error.message));
    onDone(kind === 'confirm' ? 'تم تأكيد الحجز' : kind === 'propose' ? 'تم إرسال الموعد المقترح للعميل' : 'تم رفض الحجز');
  }

  return (
    <Dialog title={`${title}: ${b.customer_name}`} onClose={onClose}>
      {kind !== 'reject' && (
        <Field label={kind === 'confirm' ? 'الموعد المؤكد' : 'الموعد المقترح'}>
          <input type="datetime-local" className="input" value={when} onChange={(e) => setWhen(e.target.value)} />
        </Field>
      )}
      <Field label={kind === 'reject' ? 'سبب الرفض (العميل هيشوفه)' : 'ملاحظة (اختياري)'}>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <ErrorBox text={error} />
      <div className="flex gap-2">
        <button className={`${kind === 'reject' ? 'btn-danger' : 'btn-primary'} flex-1`} disabled={busy} onClick={go}>{title}</button>
        <button className="btn-secondary flex-1" onClick={onClose}>إلغاء</button>
      </div>
    </Dialog>
  );
}
