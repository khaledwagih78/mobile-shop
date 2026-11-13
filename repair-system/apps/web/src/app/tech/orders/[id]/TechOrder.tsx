'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { DEVICE_TYPE_LABELS, STATUS_LABELS, arabicError, type RepairStatus } from '@kmr/shared';
import { PartPicker, type PickedPart } from '@/components/PartPicker';
import { PhotoPicker } from '@/components/PhotoPicker';
import { ErrorBox, Field, Flash, Loading, StatusBadge } from '@/components/ui';
import { fmtDateTime, money } from '@/lib/format';
import { useIdempotencyKey, useLiveRefresh, useRpc } from '@/lib/hooks';
import { signedUrls, uploadDeviceMedia, type MediaKind } from '@/lib/media';
import { supabaseBrowser } from '@/lib/supabase/client';

interface D {
  order: {
    id: string; order_number: string; status: RepairStatus; version: number; issue_description: string;
    intake_condition: string | null; intake_damages: { area: string; note?: string }[]; accessories: string[];
    expected_ready_at: string | null; is_overdue: boolean; repair_report: string | null; test_passed: boolean | null;
    test_notes: string | null; internal_notes: string | null;
  };
  device: { id: string; branch_id: string; device_type: keyof typeof DEVICE_TYPE_LABELS; brand: string; model: string; color: string | null; imei: string | null; serial_number: string | null; has_passcode: boolean };
  assignment: { assigned_at: string; accepted_at: string | null; assigned_by: string | null };
  approval: { status: string; amount: number; customer_details: string; responded_at: string | null; response_note: string | null } | null;
  diagnostics: { id: string; findings: string; fault_category: string | null; proposed_solution: string; estimated_minutes: number | null; status: string; submitted_at: string }[];
  parts: { id: string; part_name: string; qty: number; status: string; installed_at: string | null }[];
  media: { id: string; storage_path: string; kind: string; created_at: string }[];
  timeline: { event_type: string; to_status: RepairStatus | null; actor: string | null; public_note: string | null; internal_note: string | null; at: string }[];
}

const PART_STATUS: Record<string, string> = { REQUIRED: 'مطلوبة', ORDERED: 'اتطلبت', RECEIVED: 'وصلت', INSTALLED: 'اتركبت', CANCELLED: 'ملغية' };

export function TechOrder({ id }: { id: string }) {
  const sb = supabaseBrowser();
  const { data: d, error, loading, reload } = useRpc<D>('tech_order_details', { p_order: id }, id);
  const cats = useRpc<string[]>('fault_categories', {}, 'cats');
  useLiveRefresh(['repair_orders', 'technician_assignments'], reload);
  const idem = useIdempotencyKey();
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [passcode, setPasscode] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<File[]>([]);

  // diagnosis form
  const [findings, setFindings] = useState('');
  const [category, setCategory] = useState('');
  const [solution, setSolution] = useState('');
  const [minutes, setMinutes] = useState<number | ''>('');
  const [reqParts, setReqParts] = useState<PickedPart[]>([]);
  // test / finish
  const [testNotes, setTestNotes] = useState('');
  const [report, setReport] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (d) signedUrls(d.media.map((m) => m.storage_path)).then(setUrls);
    if (d?.order.repair_report) setReport((r) => r || d.order.repair_report!);
  }, [d]);

  if (loading && !d) return <Loading />;
  if (!d) return <ErrorBox text={error ?? 'الجهاز مش مسند ليك'} />;
  const o = d.order;
  const s = o.status;
  const accepted = !!d.assignment.accepted_at;
  const submittedDiag = d.diagnostics.find((x) => x.status === 'SUBMITTED');

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>, okText: string, after?: () => void) {
    setBusy(true);
    const { error: e } = await fn();
    setBusy(false);
    if (e) return setFlash({ ok: false, text: arabicError(e.message) });
    setFlash({ ok: true, text: okText });
    idem.renew();
    setNote('');
    after?.();
    reload();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const move = (to: RepairStatus, okText: string) =>
    run(() => sb.rpc('change_repair_status', {
      p_order: id, p_to: to, p_public_note: null, p_internal_note: note.trim() || null,
      p_expected_version: o.version, p_idempotency_key: idem.key,
    }), okText);

  async function uploadPhotos(kind: MediaKind) {
    if (!photos.length) return;
    setBusy(true);
    const r = await uploadDeviceMedia({ branchId: d!.device.branch_id, deviceId: d!.device.id, orderId: id, kind, files: photos });
    setBusy(false);
    setPhotos([]);
    setFlash(r.failed ? { ok: false, text: `${r.failed} صورة فشلت — جرّب تاني` } : { ok: true, text: `تم رفع ${r.ok} صورة` });
    reload();
  }

  const photoKind: MediaKind = s === 'UNDER_DIAGNOSIS' ? 'DIAGNOSIS' : s === 'UNDER_TESTING' ? 'TEST' : 'REPAIR';
  const noteField = (
    <Field label="ملاحظة داخلية (اختياري — للمدير)">
      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
    </Field>
  );

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href="/tech" className="text-sm font-semibold text-brand">← أجهزتي</Link>

      <section className="card space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xl font-bold" dir="ltr">{o.order_number}</span>
          <StatusBadge status={s} />
        </div>
        <div className="text-lg font-bold">{d.device.brand} {d.device.model}
          <span className="text-sm font-normal text-slate-500"> · {DEVICE_TYPE_LABELS[d.device.device_type]}{d.device.color ? ` · ${d.device.color}` : ''}</span>
        </div>
        {d.device.imei && <div className="text-sm text-slate-500">IMEI: <span dir="ltr">{d.device.imei}</span></div>}
        <div className={`text-sm ${o.is_overdue ? 'font-bold text-red-600' : 'text-slate-500'}`}>
          {o.is_overdue ? '⚠️ متأخر — ' : ''}الموعد المتوقع: {fmtDateTime(o.expected_ready_at)}
        </div>
        {d.device.has_passcode && (
          <div className="text-sm">🔑 رمز القفل:{' '}
            {passcode !== null ? <b dir="ltr">{passcode}</b> : (
              <button className="font-semibold text-brand" onClick={async () => {
                const { data, error: e } = await sb.rpc('reveal_device_passcode', { p_order: id });
                if (e) setFlash({ ok: false, text: arabicError(e.message) }); else setPasscode(String(data ?? ''));
              }}>إظهار (بيتسجّل)</button>
            )}
          </div>
        )}
      </section>

      <Flash msg={flash} />

      {/* ===================== الخطوة المطلوبة دلوقتي ===================== */}
      <section className="card space-y-3 border-2 border-brand">
        <h2 className="text-lg font-bold">المطلوب منك</h2>

        {!accepted && (
          <>
            <p className="text-sm text-slate-600">الجهاز اتسند ليك من {d.assignment.assigned_by ?? 'المدير'} — {fmtDateTime(d.assignment.assigned_at)}. اتأكد إنه وصلك فعلًا.</p>
            <button className="btn-primary w-full" disabled={busy}
              onClick={() => run(() => sb.rpc('tech_accept_assignment', { p_order: id }), 'تم تسجيل استلامك للجهاز')}>✋ استلمت الجهاز</button>
          </>
        )}

        {accepted && s === 'DEVICE_RECEIVED' && (
          <button className="btn-primary w-full" disabled={busy} onClick={() => move('UNDER_DIAGNOSIS', 'بدأ الفحص — العميل اتبلّغ')}>🔍 ابدأ الفحص</button>
        )}

        {accepted && s === 'UNDER_DIAGNOSIS' && (
          <form className="space-y-3" onSubmit={(e) => {
            e.preventDefault();
            run(() => sb.rpc('tech_submit_diagnosis', {
              p_order: id, p_findings: findings, p_proposed_solution: solution, p_fault_category: category || null,
              p_estimated_minutes: minutes === '' ? null : minutes, p_parts: reqParts, p_idempotency_key: idem.key,
            }), 'تم إرسال تقرير الفحص للمدير للتسعير', () => { setFindings(''); setSolution(''); setReqParts([]); setMinutes(''); });
          }}>
            {submittedDiag && (
              <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
                ✔ التقرير اتبعت ({fmtDateTime(submittedDiag.submitted_at)}) — مستني المدير يحدد السعر ويبعته للعميل.
                تقدر تبعت تقرير معدّل لو اكتشفت حاجة جديدة.
              </div>
            )}
            <Field label="نوع العطل">
              <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">اختار…</option>
                {(cats.data ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="تقرير الفحص — العطل اللي لقيته"><textarea className="input min-h-24 py-3" value={findings} onChange={(e) => setFindings(e.target.value)} /></Field>
            <Field label="الحل المقترح"><textarea className="input min-h-20 py-3" value={solution} onChange={(e) => setSolution(e.target.value)} /></Field>
            <Field label="الوقت المتوقع للإصلاح (دقيقة)">
              <input type="number" min={0} className="input" value={minutes} onChange={(e) => setMinutes(e.target.value === '' ? '' : Number(e.target.value))} />
            </Field>
            <div>
              <span className="label">قطع الغيار المطلوبة</span>
              <PartPicker onPick={(x) => setReqParts([...reqParts, x])} />
              {reqParts.map((x, i) => (
                <div key={i} className="mt-2 flex items-center justify-between rounded-lg bg-slate-50 p-2 text-sm">
                  <span>{x.part_name} × {x.qty}</span>
                  <button type="button" className="text-red-600" onClick={() => setReqParts(reqParts.filter((_, j) => j !== i))}>حذف</button>
                </div>
              ))}
            </div>
            <button className="btn-primary w-full" disabled={busy || findings.trim().length < 3 || solution.trim().length < 3}>📤 إرسال التقرير للمدير</button>
          </form>
        )}

        {s === 'WAITING_CUSTOMER_APPROVAL' && <p className="text-sm text-slate-600">⏳ في انتظار موافقة العميل على التكلفة — ممنوع تبدأ الإصلاح قبلها.</p>}
        {s === 'CUSTOMER_REJECTED' && <p className="text-sm text-rose-700">العميل رفض الإصلاح — ما تعملش أي حاجة في الجهاز. المدير هيجهزه للتسليم.</p>}

        {s === 'CUSTOMER_APPROVED' && (
          <>
            <p className="text-sm text-teal-700">✔ العميل وافق{d.approval ? ` على ${money(d.approval.amount)}` : ''}. ابدأ الإصلاح.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <button className="btn-primary" disabled={busy} onClick={() => move('UNDER_REPAIR', 'بدأ الإصلاح')}>🔧 ابدأ الإصلاح</button>
              <button className="btn-secondary" disabled={busy} onClick={() => move('WAITING_SPARE_PART', 'الجهاز في انتظار قطعة غيار')}>📦 مستني قطعة غيار</button>
            </div>
            {noteField}
          </>
        )}

        {s === 'WAITING_SPARE_PART' && (
          <>
            <p className="text-sm text-slate-600">الجهاز مستني قطعة غيار. لما توصل:</p>
            <button className="btn-primary w-full" disabled={busy} onClick={() => move('UNDER_REPAIR', 'رجعت للإصلاح')}>✔ القطعة وصلت — كمّل الإصلاح</button>
          </>
        )}

        {s === 'UNDER_REPAIR' && (
          <>
            <div>
              <span className="label">القطع اللي ركّبتها</span>
              <PartPicker hint="ابحث عن القطعة اللي ركّبتها…" onPick={(x) => run(() => sb.rpc('add_repair_part', {
                p_order: id, p_spare_part: x.spare_part_id, p_part_name: x.spare_part_id ? null : x.part_name, p_qty: x.qty, p_status: 'INSTALLED',
              }), `تم تسجيل ${x.part_name}`)} />
            </div>
            {noteField}
            <div className="grid gap-2 sm:grid-cols-3">
              <button className="btn-primary" disabled={busy} onClick={() => move('UNDER_TESTING', 'الجهاز تحت الاختبار')}>🧪 خلصت — للاختبار</button>
              <button className="btn-secondary" disabled={busy} onClick={() => move('WAITING_SPARE_PART', 'في انتظار قطعة')}>📦 مستني قطعة</button>
              <button className="btn-secondary" disabled={busy} onClick={() => move('UNDER_DIAGNOSIS', 'رجع للفحص — ابعت تقرير جديد')}>🔍 عطل جديد</button>
            </div>
          </>
        )}

        {s === 'UNDER_TESTING' && (
          <>
            {o.test_passed === null ? (
              <>
                <Field label="نتيجة الاختبار (اللي جربته)">
                  <textarea className="input min-h-20 py-3" value={testNotes} onChange={(e) => setTestNotes(e.target.value)}
                    placeholder="مثال: اللمس سليم، الشحن سليم، الكاميرات والصوت تمام" />
                </Field>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button className="btn-primary" disabled={busy || testNotes.trim().length < 3}
                    onClick={() => run(() => sb.rpc('tech_record_test', { p_order: id, p_passed: true, p_notes: testNotes }), 'الاختبار ناجح')}>✅ الاختبار ناجح</button>
                  <button className="btn-danger" disabled={busy || testNotes.trim().length < 3}
                    onClick={() => run(() => sb.rpc('tech_record_test', { p_order: id, p_passed: false, p_notes: testNotes }), 'تم تسجيل فشل الاختبار')}>❌ فيه مشكلة</button>
                </div>
              </>
            ) : o.test_passed ? (
              <>
                <p className="text-sm text-emerald-700">✅ الاختبار ناجح: {o.test_notes}</p>
                <Field label="تقرير الإصلاح (اتعمل إيه)">
                  <textarea className="input min-h-24 py-3" value={report} onChange={(e) => setReport(e.target.value)} />
                </Field>
                <button className="btn-primary w-full" disabled={busy || report.trim().length < 3}
                  onClick={() => run(() => sb.rpc('tech_finish_repair', { p_order: id, p_repair_report: report, p_idempotency_key: idem.key }),
                    'تم إنهاء الصيانة — الجهاز راح للمدير للاعتماد')}>🏁 انتهاء الصيانة وإرسال للاعتماد</button>
              </>
            ) : (
              <>
                <p className="text-sm text-red-700">❌ الاختبار فشل: {o.test_notes}</p>
                <button className="btn-primary w-full" disabled={busy} onClick={() => move('UNDER_REPAIR', 'رجعت للإصلاح')}>🔧 ارجع للإصلاح</button>
              </>
            )}
          </>
        )}

        {s === 'WAITING_MANAGER_APPROVAL' && <p className="text-sm text-slate-600">⏳ الجهاز عند المدير للمراجعة والاعتماد. لو طلب إعادة فحص هيرجعلك.</p>}
        {s === 'READY_FOR_PICKUP' && <p className="text-sm text-emerald-700">✔ المدير اعتمد الجهاز وجاهز للتسليم. شكرًا!</p>}
      </section>

      {/* ===================== الصور ===================== */}
      {accepted && ['UNDER_DIAGNOSIS', 'UNDER_REPAIR', 'UNDER_TESTING', 'CUSTOMER_APPROVED', 'WAITING_SPARE_PART'].includes(s) && (
        <section className="card space-y-3">
          <h2 className="font-bold">📷 صور ({photoKind === 'DIAGNOSIS' ? 'الفحص' : photoKind === 'TEST' ? 'الاختبار' : 'الإصلاح'})</h2>
          <PhotoPicker files={photos} onChange={setPhotos} />
          {photos.length > 0 && <button className="btn-primary" disabled={busy} onClick={() => uploadPhotos(photoKind)}>رفع {photos.length} صورة</button>}
        </section>
      )}

      {/* ===================== بيانات الاستلام ===================== */}
      <section className="card space-y-2 text-sm">
        <h2 className="font-bold">📥 من الاستلام</h2>
        <p className="whitespace-pre-line rounded-xl bg-slate-50 p-3">{o.issue_description}</p>
        {o.intake_condition && <p><span className="text-slate-500">الحالة الخارجية:</span> {o.intake_condition}</p>}
        {o.intake_damages.length > 0 && <p><span className="text-slate-500">خدوش/كسور:</span> {o.intake_damages.map((x) => x.area + (x.note ? `: ${x.note}` : '')).join('، ')}</p>}
        {o.accessories.length > 0 && <p><span className="text-slate-500">مع الجهاز:</span> {o.accessories.join('، ')}</p>}
        {o.internal_notes && <p className="text-amber-700">🔒 {o.internal_notes}</p>}
        {d.approval && <p><span className="text-slate-500">التكلفة المعروضة على العميل:</span> {money(d.approval.amount)} ({d.approval.status === 'APPROVED' ? 'وافق' : d.approval.status === 'REJECTED' ? 'رفض' : d.approval.status === 'PENDING' ? 'مستني رده' : 'اتغيرت'})</p>}
      </section>

      {d.parts.length > 0 && (
        <section className="card text-sm">
          <h2 className="mb-2 font-bold">🔩 قطع الغيار</h2>
          {d.parts.map((x) => (
            <div key={x.id} className="flex items-center justify-between border-b border-slate-100 py-2">
              <span>{x.part_name} × {x.qty}</span>
              <span className="flex items-center gap-2">
                <span className="badge bg-slate-100 text-navy">{PART_STATUS[x.status] ?? x.status}</span>
                {['REQUIRED', 'ORDERED', 'RECEIVED'].includes(x.status) && s === 'UNDER_REPAIR' && (
                  <button className="text-xs font-semibold text-brand" disabled={busy}
                    onClick={() => run(() => sb.rpc('set_repair_part_status', { p_part: x.id, p_status: 'INSTALLED' }), 'تم تسجيل تركيب القطعة')}>اتركبت ✔</button>
                )}
              </span>
            </div>
          ))}
        </section>
      )}

      {d.media.length > 0 && (
        <section className="card">
          <h2 className="mb-2 font-bold">الصور ({d.media.length})</h2>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {d.media.map((m) => urls[m.storage_path]
              // eslint-disable-next-line @next/next/no-img-element
              ? <a key={m.id} href={urls[m.storage_path]} target="_blank" rel="noopener noreferrer"><img src={urls[m.storage_path]} alt={m.kind} className="aspect-square w-full rounded-lg object-cover" /></a>
              : <div key={m.id} className="aspect-square rounded-lg bg-slate-100" />)}
          </div>
        </section>
      )}

      <section className="card">
        <h2 className="mb-3 font-bold">🕓 سجل الجهاز</h2>
        <ol className="space-y-2 border-r-2 border-slate-200 pr-4 text-sm">
          {d.timeline.slice().reverse().map((e, i) => (
            <li key={i}>
              <b>{e.to_status ? STATUS_LABELS[e.to_status] : e.event_type}</b>
              <span className="text-xs text-slate-500"> · {fmtDateTime(e.at)} · {e.actor ?? ''}</span>
              {e.internal_note && <div className="text-amber-700">🔒 {e.internal_note}</div>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
