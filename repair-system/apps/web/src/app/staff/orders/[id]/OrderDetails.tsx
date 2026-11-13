'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  DEVICE_TYPE_LABELS, ROLE_LABELS, STATUS_LABELS, arabicError, displayPhone, readyMessage, waLink,
  type AppRole, type RepairStatus,
} from '@kmr/shared';
import { PhotoPicker } from '@/components/PhotoPicker';
import { Dialog, ErrorBox, Field, Flash, Loading, StatusBadge } from '@/components/ui';
import { fmtDateTime, fromLocalInput, money, toLocalInput } from '@/lib/format';
import { useLiveRefresh, useRpc } from '@/lib/hooks';
import { signedUrls, uploadDeviceMedia } from '@/lib/media';
import { supabaseBrowser } from '@/lib/supabase/client';

interface Details {
  order: {
    id: string; order_number: string | null; status: RepairStatus; version: number; issue_description: string;
    intake_condition: string | null; intake_damages: { area: string; note?: string }[]; accessories: string[];
    received_at: string | null; received_by: string | null; expected_ready_at: string | null; is_overdue: boolean;
    quoted_cost: number | null; approved_cost: number | null; warranty_days: number; repair_report: string | null;
    test_passed: boolean | null; test_notes: string | null; internal_notes: string | null; tracking_token: string;
    completed_at: string | null; ready_at: string | null; delivered_at: string | null; cancelled_at: string | null;
    cancel_reason: string | null; current_technician_id: string | null; current_technician_name: string | null;
  };
  customer: { id: string; full_name: string; phone: string; alt_phone: string | null; has_account: boolean; account_verified: boolean };
  device: { id: string; device_type: keyof typeof DEVICE_TYPE_LABELS; brand: string; model: string; color: string | null; imei: string | null; serial_number: string | null; has_passcode: boolean };
  timeline: { id: string; event_type: string; from_status: RepairStatus | null; to_status: RepairStatus | null; actor: string | null; actor_role: AppRole | null; public_note: string | null; internal_note: string | null; metadata: Record<string, unknown>; at: string }[];
  assignments: { id: string; technician_name: string; assigned_by: string; assigned_at: string; accepted_at: string | null; ended_at: string | null; end_reason: string | null; is_current: boolean }[];
  diagnostics: { id: string; findings: string; fault_category: string | null; proposed_solution: string; status: string; submitted_at: string; technician_name: string }[];
  parts: { id: string; part_name: string; qty: number; unit_price: number; status: string; added_by: string | null; created_at: string }[];
  approvals: { id: string; amount: number; customer_details: string; status: string; requested_by: string; requested_at: string; responded_at: string | null; responded_via: string | null; response_note: string | null }[];
  media: { id: string; storage_path: string; kind: string; caption: string | null; uploaded_by: string | null; created_at: string }[];
  handover: { outcome: string; handed_by: string; handed_at: string; received_by_name: string; verification_method: string } | null;
}
interface Tech { employee_id: string; full_name: string; role: AppRole; job_title: string | null; open_orders: number }

const EVENT_LABELS: Record<string, string> = {
  CREATED: 'إنشاء الطلب', STATUS_CHANGED: 'تغيير الحالة', TECH_ASSIGNED: 'تعيين فني', TECH_CHANGED: 'تغيير الفني',
  TECH_ACCEPTED: 'الفني استلم الجهاز', DIAGNOSIS_SUBMITTED: 'تقرير الفحص', PART_ADDED: 'إضافة قطعة غيار',
  PART_STATUS: 'تحديث قطعة غيار', TEST_RECORDED: 'نتيجة الاختبار', QUOTE_REVISED: 'تعديل التكلفة', MEDIA_ADDED: 'إضافة صور',
  ETA_CHANGED: 'تغيير موعد الانتهاء', BOOKING_RESCHEDULE_PROPOSED: 'اقتراح موعد', BOOKING_TIME_CHANGED: 'تغيير موعد الحجز',
};
const APPROVAL_LABELS: Record<string, string> = { PENDING: 'في انتظار الرد', APPROVED: 'وافق', REJECTED: 'رفض', SUPERSEDED: 'تم استبداله بسعر جديد', EXPIRED: 'انتهت صلاحيته' };

function Info({ k, v, ltr }: { k: string; v: React.ReactNode; ltr?: boolean }) {
  return (
    <div className="flex justify-between gap-3 border-b border-slate-100 py-2 text-sm last:border-0">
      <span className="text-slate-500">{k}</span><span className="text-left font-semibold" dir={ltr ? 'ltr' : undefined}>{v || '—'}</span>
    </div>
  );
}

export function OrderDetails({ id, role, branchId, canManage }: { id: string; role: AppRole; branchId: string | null; canManage: boolean }) {
  const { data: d, error, loading, reload } = useRpc<Details>('staff_order_details', { p_order: id }, id);
  useLiveRefresh(['repair_orders', 'technician_assignments'], reload);
  const sb = supabaseBrowser();
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [notes, setNotes] = useState<string | null>(null);
  const [eta, setEta] = useState('');
  const [passcode, setPasscode] = useState<string | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!d) return;
    setNotes((n) => (n === null ? d.order.internal_notes ?? '' : n));
    setEta((v) => v || toLocalInput(d.order.expected_ready_at));
    signedUrls(d.media.map((m) => m.storage_path)).then(setUrls);
  }, [d]);

  if (loading && !d) return <Loading />;
  if (!d) return <ErrorBox text={error ?? 'الطلب غير موجود'} />;
  const o = d.order;

  async function act(fn: () => PromiseLike<{ error: { message: string } | null }>, okText: string) {
    const { error: e } = await fn();
    setFlash(e ? { ok: false, text: arabicError(e.message) } : { ok: true, text: okText });
    if (!e) reload();
  }

  const waText = o.status === 'READY_FOR_PICKUP' && o.order_number
    ? readyMessage(o.order_number)
    : `خالد لصيانة المحمول — طلب ${o.order_number ?? ''}: ${STATUS_LABELS[o.status]}`;

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-2xl font-bold" dir="ltr">{o.order_number ?? 'حجز (لم يُستلم بعد)'}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <StatusBadge status={o.status} />
            {o.is_overdue && <span className="badge bg-red-50 text-red-700">⚠️ متأخر عن الموعد</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {o.order_number && <Link href={`/staff/orders/${id}/receipt`} className="btn-secondary">🧾 الإيصال</Link>}
          <a href={waLink(d.customer.phone, waText)} target="_blank" rel="noopener noreferrer" className="btn bg-[#25D366] text-white">🟢 واتساب للعميل</a>
        </div>
      </div>

      <Flash msg={flash} />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ---------- العميل ---------- */}
        <section className="card">
          <h2 className="mb-2 font-bold">👤 العميل</h2>
          <Info k="الاسم" v={d.customer.full_name} />
          <Info k="الموبايل" v={displayPhone(d.customer.phone)} ltr />
          {d.customer.alt_phone && <Info k="موبايل آخر" v={displayPhone(d.customer.alt_phone)} ltr />}
          <Info k="حساب التطبيق" v={!d.customer.has_account ? 'لا يوجد' : d.customer.account_verified ? 'موثّق ✔' : 'غير موثّق'} />
        </section>

        {/* ---------- الجهاز ---------- */}
        <section className="card">
          <h2 className="mb-2 font-bold">📱 الجهاز</h2>
          <Info k="النوع" v={DEVICE_TYPE_LABELS[d.device.device_type]} />
          <Info k="الموديل" v={`${d.device.brand} ${d.device.model}`} />
          <Info k="اللون" v={d.device.color} />
          <Info k="IMEI" v={d.device.imei} ltr />
          <Info k="السيريال" v={d.device.serial_number} ltr />
          {d.device.has_passcode && (
            <Info k="رمز القفل" v={passcode ?? (canManage
              ? <button className="text-brand" onClick={async () => {
                  const { data, error: e } = await sb.rpc('reveal_device_passcode', { p_order: id });
                  if (e) setFlash({ ok: false, text: arabicError(e.message) }); else setPasscode(String(data ?? ''));
                }}>إظهار (بيتسجّل)</button>
              : 'مسجّل — للمدير والفني فقط')} ltr={!!passcode} />
          )}
        </section>

        {/* ---------- الفني ---------- */}
        <section className="card">
          <h2 className="mb-2 font-bold">🧑‍🔧 الفني</h2>
          <Info k="الفني الحالي" v={o.current_technician_name ?? 'لم يُعيّن'} />
          {d.assignments.find((a) => a.is_current) && (
            <Info k="استلم إلكترونيًا" v={d.assignments.find((a) => a.is_current)?.accepted_at ? fmtDateTime(d.assignments.find((a) => a.is_current)!.accepted_at) : 'لسه'} />
          )}
          {canManage && !['NEW_REQUEST', 'BOOKING_CONFIRMED', 'READY_FOR_PICKUP', 'DELIVERED', 'CANCELLED'].includes(o.status) && (
            <button className="btn-primary mt-3 w-full" onClick={() => setAssignOpen(true)}>
              {o.current_technician_id ? 'تغيير الفني' : 'تعيين فني'}
            </button>
          )}
          {d.assignments.length > 0 && (
            <ul className="mt-3 space-y-2 text-xs text-slate-500">
              {d.assignments.map((a) => (
                <li key={a.id} className={a.is_current ? 'font-bold text-navy' : ''}>
                  {a.technician_name} — عيّنه {a.assigned_by} {fmtDateTime(a.assigned_at)}
                  {a.ended_at ? ` · انتهى ${fmtDateTime(a.ended_at)}${a.end_reason ? ` (${a.end_reason})` : ''}` : ''}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ---------- الاستلام والعطل ---------- */}
        <section className="card">
          <h2 className="mb-2 font-bold">📥 الاستلام والعطل</h2>
          <Info k="استلمه" v={o.received_by} />
          <Info k="وقت الاستلام" v={fmtDateTime(o.received_at)} />
          <Info k="الحالة الخارجية" v={o.intake_condition} />
          {o.intake_damages.length > 0 && <Info k="خدوش/كسور" v={o.intake_damages.map((x) => x.area + (x.note ? `: ${x.note}` : '')).join('، ')} />}
          {o.accessories.length > 0 && <Info k="المستلم معه" v={o.accessories.join('، ')} />}
          <Info k="الضمان" v={o.warranty_days ? `${o.warranty_days} يوم` : 'بدون'} />
          <p className="mt-3 whitespace-pre-line rounded-xl bg-slate-50 p-3 text-sm">{o.issue_description}</p>
          <div className="mt-3 flex items-end gap-2">
            <Field label="الموعد المتوقع للانتهاء"><input type="datetime-local" className="input" value={eta} onChange={(e) => setEta(e.target.value)} /></Field>
            <button className="btn-secondary" onClick={() => act(() => sb.rpc('staff_set_expected_ready', { p_order: id, p_expected: fromLocalInput(eta) }), 'تم تحديث الموعد (والعميل يشوفه)')}>حفظ</button>
          </div>
        </section>

        {/* ---------- ملاحظات داخلية + مراحل ---------- */}
        <section className="card space-y-3">
          <h2 className="font-bold">🔒 ملاحظات داخلية (العميل لا يراها)</h2>
          <textarea className="input min-h-24 py-3" value={notes ?? ''} onChange={(e) => setNotes(e.target.value)} />
          <button className="btn-secondary" onClick={() => act(() => sb.rpc('staff_set_internal_notes', { p_order: id, p_notes: notes }), 'تم حفظ الملاحظات')}>حفظ الملاحظات</button>
          <div className="border-t pt-3">
            <Info k="انتهى الإصلاح (الفني)" v={fmtDateTime(o.completed_at)} />
            <Info k="اعتماد المدير" v={fmtDateTime(o.ready_at)} />
            <Info k="التسليم" v={fmtDateTime(o.delivered_at)} />
            {o.cancelled_at && <Info k="الإلغاء" v={`${fmtDateTime(o.cancelled_at)} — ${o.cancel_reason ?? ''}`} />}
            {o.approved_cost !== null && <Info k="التكلفة المعتمدة" v={money(o.approved_cost)} />}
          </div>
        </section>
      </div>

      {/* ---------- الفحص والقطع والموافقات ---------- */}
      {(d.diagnostics.length > 0 || d.parts.length > 0 || d.approvals.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="card">
            <h2 className="mb-2 font-bold">🔍 تقارير الفحص</h2>
            {d.diagnostics.length === 0 && <p className="text-sm text-slate-400">لا يوجد</p>}
            {d.diagnostics.map((x) => (
              <div key={x.id} className="mb-3 text-sm">
                <div className="font-semibold">{x.technician_name} · {fmtDateTime(x.submitted_at)}</div>
                <p>العطل: {x.findings}</p><p>الحل: {x.proposed_solution}</p>
              </div>
            ))}
          </section>
          <section className="card">
            <h2 className="mb-2 font-bold">🔩 قطع الغيار</h2>
            {d.parts.length === 0 && <p className="text-sm text-slate-400">لا يوجد</p>}
            {d.parts.map((x) => (
              <div key={x.id} className="flex justify-between border-b border-slate-100 py-1 text-sm">
                <span>{x.part_name} × {x.qty}</span><span>{money(x.unit_price)}</span>
              </div>
            ))}
          </section>
          <section className="card">
            <h2 className="mb-2 font-bold">✍️ موافقات العميل</h2>
            {d.approvals.length === 0 && <p className="text-sm text-slate-400">لا يوجد</p>}
            {d.approvals.map((x) => (
              <div key={x.id} className="mb-2 text-sm">
                <b>{money(x.amount)}</b> — {APPROVAL_LABELS[x.status] ?? x.status}
                <div className="text-xs text-slate-500">طلبها {x.requested_by} {fmtDateTime(x.requested_at)}{x.responded_at ? ` · رد ${fmtDateTime(x.responded_at)}` : ''}</div>
              </div>
            ))}
          </section>
        </div>
      )}

      {/* ---------- الصور ---------- */}
      <section className="card space-y-3">
        <h2 className="font-bold">📷 صور الجهاز ({d.media.length})</h2>
        {d.media.length > 0 && (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {d.media.map((m) => urls[m.storage_path] ? (
              <a key={m.id} href={urls[m.storage_path]} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={urls[m.storage_path]} alt={m.caption ?? m.kind} className="aspect-square w-full rounded-lg object-cover" />
              </a>
            ) : <div key={m.id} className="aspect-square rounded-lg bg-slate-100" />)}
          </div>
        )}
        <PhotoPicker files={photos} onChange={setPhotos} />
        {photos.length > 0 && branchId && (
          <button className="btn-primary" disabled={uploading} onClick={async () => {
            setUploading(true);
            const r = await uploadDeviceMedia({ branchId, deviceId: d.device.id, orderId: id, kind: 'INTAKE', files: photos });
            setUploading(false);
            setPhotos([]);
            setFlash(r.failed ? { ok: false, text: `${r.failed} صورة فشلت` } : { ok: true, text: `تم رفع ${r.ok} صورة` });
            reload();
          }}>{uploading ? 'جاري الرفع…' : `رفع ${photos.length} صورة`}</button>
        )}
      </section>

      {/* ---------- سجل الحركة ---------- */}
      <section className="card">
        <h2 className="mb-3 font-bold">🕓 سجل حركة الجهاز (لا يمكن تعديله)</h2>
        <ol className="space-y-3 border-r-2 border-slate-200 pr-4">
          {d.timeline.slice().reverse().map((e) => (
            <li key={e.id} className="relative text-sm">
              <span className="absolute -right-[23px] top-1.5 h-3 w-3 rounded-full bg-brand" />
              <div className="font-semibold">
                {EVENT_LABELS[e.event_type] ?? e.event_type}
                {e.to_status && e.event_type !== 'TECH_ASSIGNED' && e.event_type !== 'TECH_CHANGED' ? ` ← ${STATUS_LABELS[e.to_status]}` : ''}
              </div>
              <div className="text-xs text-slate-500">
                {fmtDateTime(e.at)} · {e.actor ?? (e.actor_role ? ROLE_LABELS[e.actor_role] : 'العميل / النظام')}
                {e.actor_role ? ` (${ROLE_LABELS[e.actor_role]})` : ''}
              </div>
              {e.public_note && <div className="text-slate-700">{e.public_note}</div>}
              {e.internal_note && <div className="text-amber-700">🔒 {e.internal_note}</div>}
            </li>
          ))}
        </ol>
      </section>

      {assignOpen && (
        <AssignDialog orderId={id} currentId={o.current_technician_id} role={role}
          onClose={() => setAssignOpen(false)}
          onDone={(t) => { setAssignOpen(false); setFlash({ ok: true, text: t }); reload(); }} />
      )}
    </div>
  );
}

function AssignDialog({ orderId, currentId, onClose, onDone }: { orderId: string; currentId: string | null; role: AppRole; onClose: () => void; onDone: (t: string) => void }) {
  const techs = useRpc<Tech[]>('staff_list_technicians', {}, 'techs');
  const [pick, setPick] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={currentId ? 'تغيير الفني' : 'تعيين فني'} onClose={onClose}>
      <div className="space-y-2">
        {(techs.data ?? []).filter((t) => t.employee_id !== currentId).map((t) => (
          <label key={t.employee_id} className={`flex cursor-pointer items-center justify-between rounded-xl border p-3 ${pick === t.employee_id ? 'border-brand bg-brand-50' : 'border-slate-200'}`}>
            <span className="flex items-center gap-2">
              <input type="radio" name="tech" checked={pick === t.employee_id} onChange={() => setPick(t.employee_id)} />
              <b>{t.full_name}</b> <span className="text-xs text-slate-400">{t.job_title ?? ROLE_LABELS[t.role]}</span>
            </span>
            <span className="text-xs text-slate-500">{t.open_orders} جهاز معاه</span>
          </label>
        ))}
        {techs.data?.length === 0 && <p className="text-sm text-slate-500">مفيش فنيين — ضيفهم من إدارة المستخدمين.</p>}
      </div>
      {currentId && (
        <Field label="سبب التغيير (بيتسجل في سجل الجهاز)">
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      )}
      <ErrorBox text={error} />
      <div className="flex gap-2">
        <button className="btn-primary flex-1" disabled={!pick || busy} onClick={async () => {
          setBusy(true);
          const { error: e } = await supabaseBrowser().rpc('assign_technician', { p_order: orderId, p_technician: pick, p_reason: reason.trim() || null });
          setBusy(false);
          if (e) return setError(arabicError(e.message));
          onDone('تم تعيين الفني وإبلاغه');
        }}>تأكيد</button>
        <button className="btn-secondary flex-1" onClick={onClose}>إلغاء</button>
      </div>
    </Dialog>
  );
}
