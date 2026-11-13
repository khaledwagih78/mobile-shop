'use client';
import { useMemo, useState } from 'react';
import { arabicError, readyMessage, waLink, type RepairStatus } from '@kmr/shared';
import { Dialog, ErrorBox, Field } from '@/components/ui';
import { fmtDateTime, money } from '@/lib/format';
import { useIdempotencyKey } from '@/lib/hooks';
import { supabaseBrowser } from '@/lib/supabase/client';

export interface ActionsData {
  order: { id: string; order_number: string | null; status: RepairStatus; version: number; repair_report: string | null; test_passed: boolean | null; test_notes: string | null };
  customer: { full_name: string; phone: string };
  diagnostics: { id: string; findings: string; fault_category: string | null; proposed_solution: string; status: string; submitted_at: string; technician_name: string }[];
  parts: { id: string; part_name: string; qty: number; unit_price: number; status: string }[];
  approvals: { id: string; amount: number; customer_details: string; status: string; requested_at: string }[];
}

type Done = (text: string, ok?: boolean) => void;
type Modal = null | 'quote' | 'response' | 'withdraw' | 'return' | 'recheck' | 'deliver';

function quoteMessage(orderNumber: string, amount: number, url: string) {
  return [
    'خالد لصيانة المحمول',
    '',
    `تم الانتهاء من فحص جهازك — طلب رقم ${orderNumber}.`,
    `التكلفة المقترحة للإصلاح: ${money(amount)}`,
    '',
    'برجاء الاطلاع على تقرير الفحص والموافقة أو الرفض من الرابط:',
    url,
    '',
    'لن نبدأ أي إصلاح قبل موافقتك.',
  ].join('\n');
}

export function ManagerActions({ d, canManage, onDone }: { d: ActionsData; canManage: boolean; onDone: Done }) {
  const [modal, setModal] = useState<Modal>(null);
  const [sentLink, setSentLink] = useState<{ url: string; amount: number } | null>(null);
  const sb = supabaseBrowser();
  const o = d.order;
  const s = o.status;
  const diag = d.diagnostics.filter((x) => x.status === 'SUBMITTED' || x.status === 'ACCEPTED').at(-1);
  const pending = d.approvals.find((a) => a.status === 'PENDING');

  const blocks: React.ReactNode[] = [];

  if (s === 'UNDER_DIAGNOSIS') {
    blocks.push(diag ? (
      <div key="diag" className="space-y-2">
        <p className="text-sm font-bold">📋 تقرير الفحص من {diag.technician_name} — {fmtDateTime(diag.submitted_at)}</p>
        <p className="text-sm">العطل{diag.fault_category ? ` (${diag.fault_category})` : ''}: {diag.findings}</p>
        <p className="text-sm">الحل المقترح: {diag.proposed_solution}</p>
        {canManage && <button className="btn-primary w-full" onClick={() => setModal('quote')}>💰 تحديد السعر وإرساله للعميل</button>}
      </div>
    ) : <p key="wait" className="text-sm text-slate-500">⏳ الفني لسه بيفحص — هيوصلك تنبيه أول ما يبعت التقرير.</p>);
  }

  if (s === 'WAITING_CUSTOMER_APPROVAL' && pending) {
    blocks.push(
      <div key="pending" className="space-y-2">
        <p className="text-sm">العرض المرسل: <b>{money(pending.amount)}</b> — {fmtDateTime(pending.requested_at)}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <button className="btn-primary" onClick={() => setModal('response')}>📞 العميل رد تليفونيًا/في المحل</button>
          {canManage && <button className="btn-secondary" onClick={() => setModal('quote')}>✏️ سعر جديد / إرسال رابط جديد</button>}
          {canManage && <button className="btn-secondary" onClick={() => setModal('withdraw')}>↩️ سحب العرض وإعادة الفحص</button>}
        </div>
      </div>,
    );
  }

  if (sentLink && o.order_number) {
    blocks.push(
      <div key="sent" className="space-y-2 rounded-xl bg-emerald-50 p-3">
        <p className="text-sm font-bold text-emerald-800">✔ العرض جاهز. ابعت الرابط للعميل:</p>
        <a className="btn w-full bg-[#25D366] text-white" target="_blank" rel="noopener noreferrer"
          href={waLink(d.customer.phone, quoteMessage(o.order_number, sentLink.amount, sentLink.url))}>🟢 إرسال رابط الموافقة على واتساب</a>
        <p className="break-all text-xs text-slate-500" dir="ltr">{sentLink.url}</p>
      </div>,
    );
  }

  if (s === 'CUSTOMER_REJECTED' && canManage) {
    blocks.push(
      <div key="rej" className="grid gap-2 sm:grid-cols-2">
        <button className="btn-primary" onClick={() => setModal('return')}>📦 تجهيز للتسليم بدون إصلاح</button>
        <button className="btn-secondary" onClick={() => setModal('quote')}>💰 عرض سعر تاني</button>
      </div>,
    );
  }

  if (['DEVICE_RECEIVED', 'UNDER_DIAGNOSIS'].includes(s) && canManage) {
    blocks.push(<button key="ret" className="btn-secondary w-full" onClick={() => setModal('return')}>↩️ إرجاع الجهاز للعميل بدون إصلاح</button>);
  }

  if (['WAITING_SPARE_PART', 'CUSTOMER_APPROVED', 'UNDER_REPAIR'].includes(s) && canManage) {
    const open = d.parts.filter((x) => ['REQUIRED', 'ORDERED'].includes(x.status));
    if (open.length) {
      blocks.push(
        <div key="parts" className="space-y-2">
          <p className="text-sm font-bold">📦 قطع مطلوبة</p>
          {open.map((x) => (
            <div key={x.id} className="flex items-center justify-between rounded-lg bg-slate-50 p-2 text-sm">
              <span>{x.part_name} × {x.qty} — {x.status === 'REQUIRED' ? 'لسه ما اتطلبتش' : 'اتطلبت'}</span>
              <span className="flex gap-2">
                {x.status === 'REQUIRED' && <button className="font-semibold text-brand" onClick={async () => {
                  const { error } = await sb.rpc('set_repair_part_status', { p_part: x.id, p_status: 'ORDERED' });
                  onDone(error ? arabicError(error.message) : 'اتسجل إن القطعة اتطلبت', !error);
                }}>اتطلبت</button>}
                <button className="font-semibold text-emerald-700" onClick={async () => {
                  const { error } = await sb.rpc('set_repair_part_status', { p_part: x.id, p_status: 'RECEIVED' });
                  onDone(error ? arabicError(error.message) : 'القطعة وصلت — الفني يقدر يكمل', !error);
                }}>وصلت ✔</button>
              </span>
            </div>
          ))}
        </div>,
      );
    }
  }

  if (s === 'WAITING_MANAGER_APPROVAL') {
    blocks.push(
      <div key="approve" className="space-y-2">
        <p className="text-sm font-bold">🔎 راجع قبل الاعتماد</p>
        <p className="text-sm"><span className="text-slate-500">تقرير الإصلاح:</span> {o.repair_report}</p>
        <p className="text-sm"><span className="text-slate-500">الاختبار:</span> {o.test_passed ? '✅ ناجح' : '❌'} — {o.test_notes}</p>
        <p className="text-xs text-slate-500">الصور والقطع المركبة تحت في الصفحة.</p>
        {canManage ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <ApproveButton orderId={o.id} onDone={onDone} />
            <button className="btn-secondary" onClick={() => setModal('recheck')}>🔁 طلب إعادة فحص</button>
          </div>
        ) : <p className="text-sm text-slate-500">الاعتماد للمدير فقط.</p>}
      </div>,
    );
  }

  if (s === 'READY_FOR_PICKUP' && o.order_number) {
    blocks.push(
      <div key="ready" className="space-y-2">
        <a className="btn w-full bg-[#25D366] text-white" target="_blank" rel="noopener noreferrer"
          href={waLink(d.customer.phone, readyMessage(o.order_number))}>🟢 إبلاغ العميل بالجاهزية على واتساب</a>
        {canManage ? <button className="btn-primary w-full" onClick={() => setModal('deliver')}>🤝 تسليم الجهاز للعميل</button>
          : <p className="text-sm text-slate-500">التسليم للمدير فقط.</p>}
      </div>,
    );
  }

  if (blocks.length === 0) return null;

  return (
    <section className="card space-y-3 border-2 border-brand">
      <h2 className="text-lg font-bold">⚡ الإجراء المطلوب</h2>
      {blocks}
      {modal === 'quote' && <QuoteDialog d={d} diag={diag} onClose={() => setModal(null)}
        onSent={(url, amount) => { setModal(null); setSentLink({ url, amount }); onDone('تم إرسال العرض — العميل يقدر يوافق من الرابط'); }} />}
      {modal === 'response' && pending && <ResponseDialog approvalId={pending.id} onClose={() => setModal(null)} onDone={(t) => { setModal(null); onDone(t); }} />}
      {modal === 'withdraw' && <ReasonDialog title="سحب العرض وإعادة الفحص" rpc="withdraw_quote" orderId={o.id} reasonKey="p_reason"
        onClose={() => setModal(null)} onDone={(t) => { setModal(null); onDone(t); }} okText="تم سحب العرض — رجع للفحص" />}
      {modal === 'recheck' && <RecheckDialog orderId={o.id} onClose={() => setModal(null)} onDone={(t) => { setModal(null); onDone(t); }} />}
      {modal === 'return' && <ReturnDialog orderId={o.id} version={o.version} onClose={() => setModal(null)} onDone={(t) => { setModal(null); onDone(t); }} />}
      {modal === 'deliver' && <DeliverDialog d={d} onClose={() => setModal(null)} onDone={(t) => { setModal(null); onDone(t); }} />}
    </section>
  );
}

function ApproveButton({ orderId, onDone }: { orderId: string; onDone: Done }) {
  const idem = useIdempotencyKey();
  const [busy, setBusy] = useState(false);
  return (
    <button className="btn-primary" disabled={busy} onClick={async () => {
      setBusy(true);
      const { error } = await supabaseBrowser().rpc('approve_completion', { p_order: orderId, p_note: null, p_idempotency_key: idem.key });
      setBusy(false);
      onDone(error ? arabicError(error.message) : '✅ تم اعتماد الجاهزية — العميل اتبلّغ إن جهازه جاهز', !error);
    }}>✅ اعتماد الجاهزية</button>
  );
}

function QuoteDialog({ d, diag, onClose, onSent }: {
  d: ActionsData; diag: ActionsData['diagnostics'][number] | undefined; onClose: () => void; onSent: (url: string, amount: number) => void;
}) {
  const idem = useIdempotencyKey();
  const editable = d.parts.filter((x) => !['CANCELLED', 'INSTALLED'].includes(x.status));
  const [prices, setPrices] = useState<Record<string, number>>(() => Object.fromEntries(editable.map((x) => [x.id, Number(x.unit_price) || 0])));
  const [labor, setLabor] = useState(0);
  const partsTotal = useMemo(() => editable.reduce((sum, x) => sum + (prices[x.id] ?? 0) * x.qty, 0), [editable, prices]);
  const [amount, setAmount] = useState<number | null>(null);
  const total = amount ?? partsTotal + labor;
  const [details, setDetails] = useState(diag ? `${diag.findings}\nالحل: ${diag.proposed_solution}` : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <Dialog title="تحديد سعر الإصلاح" onClose={onClose}>
      {editable.length > 0 && (
        <div className="space-y-2">
          <span className="label">أسعار القطع (بتتسجل وقت الاستخدام)</span>
          {editable.map((x) => (
            <div key={x.id} className="flex items-center gap-2 text-sm">
              <span className="flex-1">{x.part_name} × {x.qty}</span>
              <input type="number" min={0} className="input w-32" value={prices[x.id] ?? 0}
                onChange={(e) => { setAmount(null); setPrices({ ...prices, [x.id]: Number(e.target.value) || 0 }); }} />
            </div>
          ))}
        </div>
      )}
      <Field label="المصنعية"><input type="number" min={0} className="input" value={labor} onChange={(e) => { setAmount(null); setLabor(Number(e.target.value) || 0); }} /></Field>
      <Field label="الإجمالي المعروض على العميل" hint="محسوب تلقائيًا — تقدر تعدّله">
        <input type="number" min={0} className="input text-lg font-bold" value={total} onChange={(e) => setAmount(Number(e.target.value) || 0)} />
      </Field>
      <Field label="تقرير الفحص كما يظهر للعميل (بدون أي أسماء)">
        <textarea className="input min-h-24 py-3" value={details} onChange={(e) => setDetails(e.target.value)} />
      </Field>
      <ErrorBox text={error} />
      <div className="flex gap-2">
        <button className="btn-primary flex-1" disabled={busy} onClick={async () => {
          setBusy(true);
          const { data, error: e } = await supabaseBrowser().rpc('send_quote', {
            p_order: d.order.id, p_amount: total, p_customer_details: details,
            p_part_prices: editable.map((x) => ({ repair_part_id: x.id, unit_price: prices[x.id] ?? 0 })),
            p_idempotency_key: idem.key,
          });
          setBusy(false);
          if (e) return setError(arabicError(e.message));
          const url = String((data as { approval_url: string }).approval_url);
          onSent(url.startsWith('http') ? url : window.location.origin + url, total);
        }}>إرسال للعميل</button>
        <button className="btn-secondary flex-1" onClick={onClose}>إلغاء</button>
      </div>
    </Dialog>
  );
}

function ResponseDialog({ approvalId, onClose, onDone }: { approvalId: string; onClose: () => void; onDone: (t: string) => void }) {
  const [approve, setApprove] = useState<boolean | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog title="تسجيل رد العميل" onClose={onClose}>
      <div className="grid grid-cols-2 gap-2">
        <button className={`btn ${approve === true ? 'bg-emerald-600 text-white' : 'btn-secondary'}`} onClick={() => setApprove(true)}>وافق</button>
        <button className={`btn ${approve === false ? 'bg-rose-600 text-white' : 'btn-secondary'}`} onClick={() => setApprove(false)}>رفض</button>
      </div>
      <Field label="إزاي رد؟ (إلزامي — بيتسجل)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثال: وافق في مكالمة الساعة 3" /></Field>
      <ErrorBox text={error} />
      <button className="btn-primary w-full" disabled={approve === null || note.trim().length < 3} onClick={async () => {
        const { error: e } = await supabaseBrowser().rpc('staff_record_quote_response', { p_approval: approvalId, p_approve: approve, p_note: note });
        if (e) return setError(arabicError(e.message));
        onDone(approve ? 'تم تسجيل موافقة العميل — الفني يقدر يبدأ' : 'تم تسجيل رفض العميل');
      }}>تسجيل</button>
    </Dialog>
  );
}

function ReasonDialog({ title, rpc, orderId, reasonKey, okText, onClose, onDone }: {
  title: string; rpc: string; orderId: string; reasonKey: string; okText: string; onClose: () => void; onDone: (t: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog title={title} onClose={onClose}>
      <Field label="السبب"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <ErrorBox text={error} />
      <button className="btn-primary w-full" disabled={reason.trim().length < 3} onClick={async () => {
        const { error: e } = await supabaseBrowser().rpc(rpc, { p_order: orderId, [reasonKey]: reason });
        if (e) return setError(arabicError(e.message));
        onDone(okText);
      }}>تأكيد</button>
    </Dialog>
  );
}

function RecheckDialog({ orderId, onClose, onDone }: { orderId: string; onClose: () => void; onDone: (t: string) => void }) {
  const [reason, setReason] = useState('');
  const [back, setBack] = useState<'UNDER_REPAIR' | 'UNDER_DIAGNOSIS'>('UNDER_REPAIR');
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog title="طلب إعادة فحص" onClose={onClose}>
      <div className="grid grid-cols-2 gap-2">
        <button className={`btn ${back === 'UNDER_REPAIR' ? 'bg-brand text-white' : 'btn-secondary'}`} onClick={() => setBack('UNDER_REPAIR')}>يرجع للإصلاح</button>
        <button className={`btn ${back === 'UNDER_DIAGNOSIS' ? 'bg-brand text-white' : 'btn-secondary'}`} onClick={() => setBack('UNDER_DIAGNOSIS')}>يرجع للفحص</button>
      </div>
      <Field label="إيه المشكلة؟ (الفني هيشوفها)"><textarea className="input min-h-20 py-3" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <ErrorBox text={error} />
      <button className="btn-primary w-full" disabled={reason.trim().length < 3} onClick={async () => {
        const { error: e } = await supabaseBrowser().rpc('request_recheck', { p_order: orderId, p_reason: reason, p_back_to: back });
        if (e) return setError(arabicError(e.message));
        onDone('رجع للفني لإعادة الفحص');
      }}>إرسال للفني</button>
    </Dialog>
  );
}

function ReturnDialog({ orderId, version, onClose, onDone }: { orderId: string; version: number; onClose: () => void; onDone: (t: string) => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog title="إرجاع الجهاز بدون إصلاح" onClose={onClose}>
      <p className="text-sm text-slate-500">الجهاز هيتحول لـ "جاهز للاستلام" والعميل هيتبلغ. التسليم بيتسجل "بدون إصلاح".</p>
      <Field label="السبب (العميل هيشوفه)"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: العطل غير قابل للإصلاح" /></Field>
      <ErrorBox text={error} />
      <button className="btn-primary w-full" disabled={reason.trim().length < 3} onClick={async () => {
        const { error: e } = await supabaseBrowser().rpc('change_repair_status', {
          p_order: orderId, p_to: 'READY_FOR_PICKUP', p_public_note: reason, p_internal_note: null, p_expected_version: version,
        });
        if (e) return setError(arabicError(e.message));
        onDone('الجهاز جاهز للتسليم بدون إصلاح');
      }}>تأكيد</button>
    </Dialog>
  );
}

const VERIFY_METHODS = [
  { v: 'PHONE_MATCH', l: 'رقم الموبايل مطابق' },
  { v: 'ORDER_QR', l: 'عرض الإيصال / الـ QR' },
  { v: 'NATIONAL_ID', l: 'البطاقة الشخصية' },
  { v: 'KNOWN_CUSTOMER', l: 'عميل معروف للمحل' },
];

function DeliverDialog({ d, onClose, onDone }: { d: ActionsData; onClose: () => void; onDone: (t: string) => void }) {
  const idem = useIdempotencyKey();
  const [name, setName] = useState(d.customer.full_name);
  const [phone, setPhone] = useState('');
  const [method, setMethod] = useState('PHONE_MATCH');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title="تسليم الجهاز" onClose={onClose}>
      <Field label="اسم المستلم"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="موبايل المستلم (لو حد غير العميل)"><input className="input text-left" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
      <Field label="اتأكدت من الشخصية إزاي؟">
        <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
          {VERIFY_METHODS.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
        </select>
      </Field>
      <Field label="ملاحظات (اختياري)"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <ErrorBox text={error} />
      <button className="btn-primary w-full" disabled={busy || name.trim().length < 2} onClick={async () => {
        setBusy(true);
        const { error: e } = await supabaseBrowser().rpc('deliver_device', {
          p_order: d.order.id, p_received_by_name: name, p_verification_method: method,
          p_received_by_phone: phone || null, p_notes: notes || null, p_idempotency_key: idem.key,
        });
        setBusy(false);
        if (e) return setError(arabicError(e.message));
        onDone('🤝 تم تسليم الجهاز');
      }}>تأكيد التسليم</button>
    </Dialog>
  );
}
