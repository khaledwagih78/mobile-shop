'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { DEVICE_TYPE_LABELS, arabicError, displayPhone, errorCode, isEgyptMobile } from '@kmr/shared';
import { PhotoPicker } from '@/components/PhotoPicker';
import { ErrorBox, Field } from '@/components/ui';
import { fromLocalInput, toLocalInput } from '@/lib/format';
import { useIdempotencyKey, useRpc } from '@/lib/hooks';
import { uploadDeviceMedia } from '@/lib/media';
import { supabaseBrowser } from '@/lib/supabase/client';

type DeviceType = keyof typeof DEVICE_TYPE_LABELS;
interface Device { id: string; device_type: DeviceType; brand: string; model: string; color: string | null; imei: string | null }
interface CustomerHit {
  id: string; full_name: string; phone: string; has_account: boolean; account_verified: boolean;
  orders_count: number; devices: Device[];
}
interface BookingRow {
  id: string; status: string; customer_id: string; customer_name: string; customer_phone: string;
  device_type: DeviceType; brand: string; model: string; issue_description: string;
}
interface Settings { branch_id: string; default_eta_hours: number; default_warranty_days: number }

const DAMAGE_CHIPS = ['خدوش', 'كسر في الشاشة', 'كسر في الظهر', 'انبعاج في الإطار', 'آثار مياه', 'زرار ناقص/مكسور', 'كاميرا مشروخة'];
const ACCESSORY_CHIPS = ['جراب', 'شاحن', 'كابل', 'شريحة', 'كارت ميموري', 'علبة', 'سماعة'];

export function IntakeForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const bookingId = sp.get('booking');
  const idem = useIdempotencyKey();
  const settings = useRpc<Settings>('get_branch_settings', {}, 'settings');

  // ---------- customer ----------
  const [q, setQ] = useState('');
  const hits = useRpc<CustomerHit[]>('staff_search_customers', { p_q: q }, q);
  const [customer, setCustomer] = useState<CustomerHit | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [accountAction, setAccountAction] = useState<'' | 'verify' | 'detach'>('');
  const [needDecision, setNeedDecision] = useState(false);

  // ---------- booking check-in ----------
  const bookings = useRpc<BookingRow[]>('staff_list_bookings',
    bookingId ? { p_statuses: ['PENDING', 'CONFIRMED', 'RESCHEDULE_PROPOSED'] } : null, bookingId ?? 'none');
  const booking = useMemo(() => (bookings.data ?? []).find((b) => b.id === bookingId) ?? null, [bookings.data, bookingId]);

  // ---------- device ----------
  const [deviceId, setDeviceId] = useState<string>('');
  const [deviceType, setDeviceType] = useState<DeviceType>('PHONE');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [color, setColor] = useState('');
  const [imei, setImei] = useState('');
  const [serial, setSerial] = useState('');
  const [passcode, setPasscode] = useState('');

  // ---------- issue & condition ----------
  const [issue, setIssue] = useState('');
  const [condition, setCondition] = useState('');
  const [damages, setDamages] = useState<{ area: string; note: string }[]>([]);
  const [accessories, setAccessories] = useState<string[]>([]);
  const [eta, setEta] = useState('');
  const [warranty, setWarranty] = useState<number | ''>('');
  const [photos, setPhotos] = useState<File[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => {
    if (settings.data && !eta) {
      setEta(toLocalInput(new Date(Date.now() + settings.data.default_eta_hours * 3600e3).toISOString()));
      setWarranty(settings.data.default_warranty_days);
    }
  }, [settings.data, eta]);

  useEffect(() => {
    if (booking) {
      setIssue((v) => v || booking.issue_description);
      setDeviceType(booking.device_type);
      setBrand(booking.brand);
      setModel(booking.model);
    }
  }, [booking]);

  function pickCustomer(c: CustomerHit) {
    setCustomer(c);
    setIsNew(false);
    setAccountAction('');
    setNeedDecision(c.has_account && !c.account_verified);
    const first = c.devices[0];
    setDeviceId(first ? first.id : '');
  }

  function toggle(list: string[], v: string) {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  }

  function validate(): string | null {
    if (!booking) {
      if (!customer && !isNew) return 'اختار العميل أو سجّل عميل جديد';
      if (isNew && newName.trim().length < 2) return 'اكتب اسم العميل';
      if (isNew && !isEgyptMobile(newPhone)) return 'رقم موبايل العميل غير صحيح';
      if (needDecision && !accountAction) return 'حدد: هل حساب التطبيق ده بتاع العميل اللي قدامك؟';
      if (!deviceId && (!brand.trim() || !model.trim())) return 'اكتب الشركة والموديل';
    }
    if (imei && !/^[0-9]{14,16}$/.test(imei.replace(/\s/g, ''))) return 'الـ IMEI لازم يكون 15 رقم';
    if (issue.trim().length < 3) return 'اكتب وصف العطل';
    if (!eta) return 'حدد موعد الانتهاء المتوقع';
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = validate();
    if (v) return setError(v);
    setError(null);
    setBusy(true);
    setProgress('جاري تسجيل الجهاز…');
    const sb = supabaseBrowser();
    const device = deviceId && !booking
      ? { id: deviceId, color: color || undefined, imei: imei || undefined, serial_number: serial || undefined }
      : { device_type: deviceType, brand: brand.trim(), model: model.trim(), color: color || undefined,
          imei: imei.replace(/\s/g, '') || undefined, serial_number: serial || undefined };
    const payload: Record<string, unknown> = {
      idempotency_key: idem.key,
      device,
      issue_description: issue.trim(),
      intake_condition: condition.trim() || null,
      intake_damages: damages.filter((d) => d.area.trim()),
      accessories,
      expected_ready_at: fromLocalInput(eta),
      warranty_days: warranty === '' ? null : warranty,
      passcode: passcode || null,
      account_action: accountAction || null,
    };
    if (booking) payload.booking_id = booking.id;
    else if (customer) payload.customer_id = customer.id;
    else payload.customer = { full_name: newName.trim(), phone: newPhone };

    const { data, error: err } = await sb.rpc('receive_device', { p: payload });
    if (err) {
      setBusy(false);
      setProgress(null);
      if (errorCode(err.message) === 'UNVERIFIED_ACCOUNT_DECISION_REQUIRED') setNeedDecision(true);
      return setError(arabicError(err.message));
    }
    const res = data as { repair_order_id: string; device_id: string };

    let photoNote = '';
    if (photos.length && settings.data) {
      setProgress(`جاري رفع ${photos.length} صورة…`);
      const r = await uploadDeviceMedia({
        branchId: settings.data.branch_id, deviceId: res.device_id, orderId: res.repair_order_id, kind: 'INTAKE', files: photos,
      });
      if (r.failed) photoNote = `&photos_failed=${r.failed}`;
    }
    router.replace(`/staff/orders/${res.repair_order_id}/receipt?new=1${photoNote}`);
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {/* ---------------- 1. العميل ---------------- */}
      <section className="card space-y-3">
        <h2 className="text-lg font-bold">1. العميل</h2>
        {booking ? (
          <div className="rounded-xl bg-brand-50 p-3">
            <div className="font-bold">حجز: {booking.customer_name}</div>
            <div className="text-sm text-slate-600" dir="ltr">{displayPhone(booking.customer_phone)}</div>
          </div>
        ) : bookingId ? (
          <p className="text-sm text-slate-500">{bookings.loading ? 'جاري تحميل الحجز…' : 'الحجز غير موجود أو اتقفل.'}</p>
        ) : customer ? (
          <div className="flex items-center justify-between rounded-xl bg-brand-50 p-3">
            <div>
              <div className="font-bold">{customer.full_name}</div>
              <div className="text-sm text-slate-600" dir="ltr">{displayPhone(customer.phone)}</div>
            </div>
            <button type="button" className="text-sm font-semibold text-brand" onClick={() => { setCustomer(null); setNeedDecision(false); }}>تغيير</button>
          </div>
        ) : isNew ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="اسم العميل"><input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} /></Field>
            <Field label="رقم الموبايل">
              <input className="input text-left" dir="ltr" inputMode="tel" placeholder="01xxxxxxxxx" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
            </Field>
            <button type="button" className="text-sm font-semibold text-brand sm:col-span-2 sm:text-right" onClick={() => setIsNew(false)}>← رجوع للبحث</button>
          </div>
        ) : (
          <div className="space-y-2">
            <input className="input" placeholder="ابحث باسم العميل أو رقم موبايله" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            {q.trim().length >= 2 && (
              <div className="divide-y rounded-xl border border-slate-200">
                {(hits.data ?? []).map((c) => (
                  <button type="button" key={c.id} onClick={() => pickCustomer(c)} className="flex w-full items-center justify-between p-3 text-right hover:bg-brand-50">
                    <span><b>{c.full_name}</b> <span className="text-sm text-slate-500" dir="ltr">{displayPhone(c.phone)}</span></span>
                    <span className="text-xs text-slate-400">{c.orders_count} زيارة · {c.devices.length} جهاز</span>
                  </button>
                ))}
                {!hits.loading && (hits.data ?? []).length === 0 && <p className="p-3 text-sm text-slate-400">مفيش عميل بالبيانات دي</p>}
              </div>
            )}
            <button type="button" className="btn-secondary w-full" onClick={() => { setIsNew(true); if (/^[0-9+ ]{8,}$/.test(q)) setNewPhone(q); else setNewName(q); }}>
              ➕ عميل جديد
            </button>
          </div>
        )}

        {needDecision && !booking && (
          <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3">
            <p className="text-sm font-bold text-amber-800">الرقم ده عليه حساب في التطبيق لسه مش موثّق. هل الحساب ده بتاع العميل اللي قدامك؟</p>
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="acc" checked={accountAction === 'verify'} onChange={() => setAccountAction('verify')} /> أيوه، بتاعه (اتأكدت من الموبايل بتاعه) — وثّق الحساب</label>
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="acc" checked={accountAction === 'detach'} onChange={() => setAccountAction('detach')} /> لأ، مش بتاعه — افصل الحساب عن بيانات العميل</label>
          </div>
        )}
      </section>

      {/* ---------------- 2. الجهاز ---------------- */}
      <section className="card space-y-3">
        <h2 className="text-lg font-bold">2. الجهاز</h2>
        {customer && customer.devices.length > 0 && !booking && (
          <div className="flex flex-wrap gap-2">
            {customer.devices.map((d) => (
              <button type="button" key={d.id} onClick={() => setDeviceId(d.id)}
                className={`badge px-4 py-2 text-sm ${deviceId === d.id ? 'bg-brand text-white' : 'bg-slate-100 text-navy'}`}>
                {d.brand} {d.model}{d.color ? ` · ${d.color}` : ''}
              </button>
            ))}
            <button type="button" onClick={() => setDeviceId('')}
              className={`badge px-4 py-2 text-sm ${deviceId === '' ? 'bg-brand text-white' : 'bg-slate-100 text-navy'}`}>➕ جهاز تاني</button>
          </div>
        )}
        {(!deviceId || booking) && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="نوع الجهاز">
              <select className="input" value={deviceType} onChange={(e) => setDeviceType(e.target.value as DeviceType)} disabled={!!booking}>
                {Object.entries(DEVICE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="الشركة"><input className="input" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Samsung" disabled={!!booking} /></Field>
            <Field label="الموديل"><input className="input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="A52" disabled={!!booking} /></Field>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="اللون"><input className="input" value={color} onChange={(e) => setColor(e.target.value)} /></Field>
          <Field label="IMEI (اطلب *#06#)"><input className="input text-left" dir="ltr" inputMode="numeric" value={imei} onChange={(e) => setImei(e.target.value)} /></Field>
          <Field label="الرقم التسلسلي"><input className="input text-left" dir="ltr" value={serial} onChange={(e) => setSerial(e.target.value)} /></Field>
        </div>
        <Field label="رمز قفل الجهاز (اختياري)" hint="بيتخزن مشفّر، ومحدش يشوفه غير الفني المسؤول والمدير، وكل مرة بتتسجل.">
          <input className="input text-left" dir="ltr" type="password" autoComplete="off" value={passcode} onChange={(e) => setPasscode(e.target.value)} />
        </Field>
      </section>

      {/* ---------------- 3. العطل والحالة ---------------- */}
      <section className="card space-y-3">
        <h2 className="text-lg font-bold">3. العطل وحالة الجهاز</h2>
        <Field label="وصف العطل (كلام العميل)">
          <textarea className="input min-h-24 py-3" value={issue} onChange={(e) => setIssue(e.target.value)} />
        </Field>
        <Field label="الحالة الخارجية عند الاستلام">
          <input className="input" value={condition} onChange={(e) => setCondition(e.target.value)} placeholder="مثال: الجهاز سليم من الخارج / الجهاز مقفول" />
        </Field>
        <div>
          <span className="label">الخدوش والكسور الموجودة</span>
          <div className="flex flex-wrap gap-2">
            {DAMAGE_CHIPS.map((d) => (
              <button type="button" key={d} className="badge bg-slate-100 px-3 py-2 text-sm text-navy hover:bg-sky-100"
                onClick={() => setDamages([...damages, { area: d, note: '' }])}>+ {d}</button>
            ))}
          </div>
          {damages.map((d, i) => (
            <div key={i} className="mt-2 flex gap-2">
              <input className="input" value={d.area} onChange={(e) => setDamages(damages.map((x, j) => j === i ? { ...x, area: e.target.value } : x))} aria-label="المكان" />
              <input className="input" value={d.note} placeholder="تفاصيل (مكانها، حجمها…)" onChange={(e) => setDamages(damages.map((x, j) => j === i ? { ...x, note: e.target.value } : x))} />
              <button type="button" className="btn-secondary px-3" onClick={() => setDamages(damages.filter((_, j) => j !== i))} aria-label="حذف">×</button>
            </div>
          ))}
        </div>
        <div>
          <span className="label">المستلم مع الجهاز</span>
          <div className="flex flex-wrap gap-2">
            {ACCESSORY_CHIPS.map((a) => (
              <button type="button" key={a} onClick={() => setAccessories(toggle(accessories, a))}
                className={`badge px-3 py-2 text-sm ${accessories.includes(a) ? 'bg-brand text-white' : 'bg-slate-100 text-navy'}`}>{a}</button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="الموعد المتوقع للانتهاء"><input type="datetime-local" className="input" value={eta} onChange={(e) => setEta(e.target.value)} /></Field>
          <Field label="مدة الضمان (يوم)">
            <input type="number" min={0} className="input" value={warranty} onChange={(e) => setWarranty(e.target.value === '' ? '' : Number(e.target.value))} />
          </Field>
        </div>
      </section>

      {/* ---------------- 4. الصور ---------------- */}
      <section className="card space-y-3">
        <h2 className="text-lg font-bold">4. صور الجهاز</h2>
        <p className="text-sm text-slate-500">صوّر الوش والظهر والجوانب وأي كسر أو خدش — دي حمايتك وحماية العميل.</p>
        <PhotoPicker files={photos} onChange={setPhotos} />
      </section>

      <ErrorBox text={error} />
      <button type="submit" className="btn-primary w-full text-lg" disabled={busy}>
        {busy ? progress ?? 'جاري التنفيذ…' : '✅ تسجيل الاستلام وإصدار الإيصال'}
      </button>
    </form>
  );
}
