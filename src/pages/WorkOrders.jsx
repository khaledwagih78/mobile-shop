import { Icon } from'../components/Icon';
import { useMemo, useState } from'react';
import { useLiveQuery } from'dexie-react-hooks';
import { useNavigate } from'react-router-dom';
import { db, today, queueSync, createWorkOrder, invoiceWorkOrder, stockOf, getSetting } from'../db';
import { money, fmt, normAr, waLink } from'../utils';
import { Modal, Toast } from'../components/UI';
import BarcodeScanner from'../components/BarcodeScanner';
import { useAuth } from'../auth';

const STATUS = {
  received: { label:'تم الاستلام', cls:'gray' },
  in_progress: { label:'تحت الصيانة', cls:'amber' },
  done: { label:'تم الإصلاح', cls:'accent' },
  delivered: { label:'تم التسليم', cls:'green' },
  cancelled: { label:'ملغي', cls:'red' },
};
const FLOW = ['received','in_progress','done'];

export default function WorkOrders() {
  const { user, activeBranch } = useAuth();
  const nav = useNavigate();
  const orders = useLiveQuery(() => db.workOrders.orderBy('createdAt').reverse().toArray(), [], []);
  const customers = useLiveQuery(() => db.customers.toArray(), [], []);
  const bizName = useLiveQuery(() => getSetting('bizName',''), [],'') ||'مركز الصيانة';
  const bizAddress = useLiveQuery(() => getSetting('bizAddress',''), [],'');
  const bizPhone = useLiveQuery(() => getSetting('bizPhone',''), [],'');
  const defWarranty = useLiveQuery(() => getSetting('warranty',''), [],'');
  const employees = useLiveQuery(() => db.employees.where('status').equals('active').toArray(), [], []);
  const items = useLiveQuery(() => db.items.toArray(), [], []);
  const [form, setForm] = useState(null);
  const [payFor, setPayFor] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [filter, setFilter] = useState('open');
  const [toast, setToast] = useState('');
  const notify = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const filtered = useMemo(() => {
    if (filter ==='all') return orders;
    if (filter ==='open') return orders.filter((o) => o.status !=='delivered' && o.status !=='cancelled');
    return orders.filter((o) => o.status === filter);
  }, [orders, filter]);

  const openNew = () => setForm({ customerId:'', customerName:'', customerPhone:'', deviceType:'', deviceInfo:'', reportedIssue:'', technicianName:'', parts: [], laborCost:'', warranty:'', notes:'', status:'received' });

  // اختيار عميل مسجّل يملأ الاسم والرقم تلقائياً (ويظلّان قابلين للتعديل)
  const pickCustomer = (idStr) => {
    const c = customers.find((x) => x.id === Number(idStr));
    setForm((f) => ({ ...f, customerId: idStr, customerName: c ? c.name : f.customerName, customerPhone: c ? (c.phone ||'') : f.customerPhone }));
  };

  const save = async () => {
    const cust = customers.find((c) => c.id === Number(form.customerId));
    const payload = {
      customerId: cust ? cust.id : null,
      customerName: (form.customerName ||'').trim() || (cust ? cust.name :''),
      customerPhone: (form.customerPhone ||'').trim() || (cust ? (cust.phone ||'') :''),
      deviceType: form.deviceType, deviceInfo: form.deviceInfo, reportedIssue: form.reportedIssue,
      technicianName: form.technicianName, parts: form.parts, laborCost: Number(form.laborCost) || 0,
      warranty: form.warranty, notes: form.notes, status: form.status, branchId: activeBranch,
    };
    if (form.id) {
      await db.workOrders.update(form.id, payload);
      await queueSync('workOrders','update', { ...payload, id: form.id });
    } else {
      await createWorkOrder(payload);
    }
    notify(' تم حفظ أمر الصيانة');
    setForm(null);
  };

  const setStatus = async (o, status) => {
    await db.workOrders.update(o.id, { status });
    await queueSync('workOrders','update', { id: o.id, status });
  };

  const doInvoice = async (paid) => {
    const res = await invoiceWorkOrder(payFor.id, { paid: paid ==='' ? null : Number(paid), userName: user.name });
    setPayFor(null);
    if (res) nav(`/invoices/${res.id}?new=1`);
  };

  const partsTotal = (o) => (o.parts || []).reduce((s, p) => s + (Number(p.qty) || 0) * (Number(p.price) || 0), 0);
  const woTotal = (o) => partsTotal(o) + (Number(o.laborCost) || 0);

  // ---------- إيصال الصيانة (واتساب + طباعة) ----------
  const escHtml = (s) => String(s == null ?'' : s).replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;' }[c]));
  const woDate = (o) => { try { return new Date(o.createdAt || Date.now()).toLocaleDateString('ar-EG'); } catch { return o.day ||''; } };

  const receiptText = (o) => {
    const L = [];
    L.push(`🧾 *${bizName}* — إيصال صيانة`);
    L.push(`رقم: ${o.number}`);
    L.push(`التاريخ: ${woDate(o)}`);
    if (o.customerName) L.push(`العميل: ${o.customerName}${o.customerPhone ?' - ' + o.customerPhone :''}`);
    L.push(`الجهاز: ${o.deviceType ||''}${o.deviceInfo ?' (' + o.deviceInfo + ')' :''}`);
    if (o.reportedIssue) L.push(`العطل: ${o.reportedIssue}`);
    if (o.technicianName) L.push(`الفني: ${o.technicianName}`);
    const parts = o.parts || [];
    if (parts.length) {
      L.push('—— القطع ——');
      parts.forEach((p) => L.push(`• ${p.name} ×${Number(p.qty) || 0} = ${money((Number(p.qty) || 0) * (Number(p.price) || 0))}`));
    }
    if (Number(o.laborCost) || 0) L.push(`أجر الصيانة: ${money(o.laborCost)}`);
    L.push(`الإجمالي: ${money(woTotal(o))}`);
    L.push(`الحالة: ${STATUS[o.status]?.label || o.status}`);
    const w = o.warranty || defWarranty;
    if (w) L.push(`الضمان: ${w}`);
    L.push('شكراً لتعاملكم معنا 🙏');
    return L.join('\n');
  };

  const sendWhatsApp = (o) => {
    window.open(waLink(o.customerPhone, receiptText(o)),'_blank');
    if (!o.customerPhone) notify('لا يوجد رقم للعميل — اختر جهة الاتصال في واتساب');
  };

  const printWorkOrder = (o) => {
    const win = window.open('','_blank');
    if (!win) { notify('اسمح بالنوافذ المنبثقة لطباعة الإيصال'); return; }
    const parts = o.parts || [];
    const rows = parts.map((p) =>`<tr><td>${escHtml(p.name)}</td><td class="c">${Number(p.qty) || 0}</td><td class="l">${escHtml(money(p.price))}</td><td class="l">${escHtml(money((Number(p.qty) || 0) * (Number(p.price) || 0)))}</td></tr>`).join('');
    const w = o.warranty || defWarranty;
    win.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
      <title>إيصال صيانة ${escHtml(o.number)}</title>
      <style>
        *{box-sizing:border-box;font-family:Cairo,Tahoma,Arial,sans-serif}
        body{margin:0;padding:22px;color:#15232B}
        .hd{text-align:center;border-bottom:2px solid #0F4C5C;padding-bottom:10px;margin-bottom:14px}
        .hd h1{margin:0;font-size:22px;color:#0F4C5C}
        .hd .sub{color:#6B7C86;font-size:13px;margin-top:3px}
        .tag{display:inline-block;background:#EAF1F3;color:#0F4C5C;border-radius:6px;padding:3px 10px;font-weight:700;font-size:13px;margin-top:6px}
        .meta{display:flex;flex-wrap:wrap;gap:6px 24px;margin:12px 0}
        .meta div{font-size:14px}
        .meta b{color:#0F4C5C}
        .box{border:1px solid #E4E9EC;border-radius:10px;padding:10px 12px;margin:10px 0}
        .box h3{margin:0 0 6px;font-size:13px;color:#6B7C86}
        table{width:100%;border-collapse:collapse;margin-top:6px}
        th,td{border-bottom:1px solid #E4E9EC;padding:7px 8px;font-size:13.5px;text-align:right}
        th{background:#F4F6F8;color:#0F4C5C}
        td.c{text-align:center}td.l{text-align:left}
        .tot{margin-top:12px;text-align:left}
        .tot .row{display:flex;justify-content:space-between;max-width:280px;margin-left:auto;padding:3px 0;font-size:14px}
        .tot .grand{font-size:18px;font-weight:800;color:#0F4C5C;border-top:2px solid #0F4C5C;margin-top:4px;padding-top:6px}
        .ft{margin-top:18px;text-align:center;color:#6B7C86;font-size:12.5px;border-top:1px dashed #cfd8dc;padding-top:10px}
        @media print{body{padding:6px}}
      </style></head><body>
      <div class="hd">
        <h1>${escHtml(bizName)}</h1>
        ${bizAddress ?`<div class="sub">${escHtml(bizAddress)}</div>` :''}
        ${bizPhone ?`<div class="sub">هاتف: ${escHtml(bizPhone)}</div>` :''}
        <div class="tag">إيصال صيانة — ${escHtml(o.number)}</div>
      </div>
      <div class="meta">
        <div><b>التاريخ:</b> ${escHtml(woDate(o))}</div>
        <div><b>العميل:</b> ${escHtml(o.customerName ||'نقدي')}</div>
        ${o.customerPhone ?`<div><b>الموبايل:</b> ${escHtml(o.customerPhone)}</div>` :''}
        ${o.technicianName ?`<div><b>الفني:</b> ${escHtml(o.technicianName)}</div>` :''}
        <div><b>الحالة:</b> ${escHtml(STATUS[o.status]?.label || o.status)}</div>
      </div>
      <div class="box"><h3>الجهاز</h3>${escHtml(o.deviceType ||'—')}${o.deviceInfo ?` — ${escHtml(o.deviceInfo)}` :''}</div>
      ${o.reportedIssue ?`<div class="box"><h3>العطل / المطلوب</h3>${escHtml(o.reportedIssue)}</div>` :''}
      ${parts.length ?`<table><thead><tr><th>القطعة</th><th class="c">كمية</th><th class="l">سعر</th><th class="l">الإجمالي</th></tr></thead><tbody>${rows}</tbody></table>` :''}
      <div class="tot">
        ${parts.length ?`<div class="row"><span>إجمالي القطع</span><span>${escHtml(money(partsTotal(o)))}</span></div>` :''}
        ${Number(o.laborCost) || 0 ?`<div class="row"><span>أجر الصيانة</span><span>${escHtml(money(o.laborCost))}</span></div>` :''}
        <div class="row grand"><span>الإجمالي</span><span>${escHtml(money(woTotal(o)))}</span></div>
      </div>
      ${w ?`<div class="box"><h3>الضمان</h3>${escHtml(w)}</div>` :''}
      <div class="ft">شكراً لتعاملكم معنا — ${escHtml(bizName)}</div>
      <script>window.onload = () => { window.print(); setTimeout(() => window.close(), 400); }</script>
      </body></html>`);
    win.document.close();
  };

  return (
    <>
      <div className="page-head">
        <h1>الصيانة وأوامر العمل</h1>
        <button className="btn accent" onClick={openNew}>＋ أمر صيانة</button>
      </div>

      <div className="list-tools">
        {['open','received','in_progress','done','delivered','all'].map((f) => (
          <button key={f} className={`btn ${filter === f ?'' :'ghost'} sm`} onClick={() => setFilter(f)}> {f ==='open' ?'المفتوحة' : f ==='all' ?'الكل' : STATUS[f].label} </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card empty"><div className="big-ico" style={{ display:'flex', justifyContent:'center' }}><Icon name="Wrench" size={40} color="var(--ink-soft)" strokeWidth={1.5} /></div><p>لا توجد أوامر صيانة</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>رقم</th><th>العميل</th><th>الجهاز/الوصف</th><th>العطل</th><th>الفني</th><th>الإجمالي</th><th>الحالة</th><th></th></tr></thead>
            <tbody>
              {filtered.map((o) => (
                <tr key={o.id}>
                  <td className="num">{o.number}</td>
                  <td>{o.customerName ||'نقدي'}{o.customerPhone ? <div className="meta muted">{o.customerPhone}</div> : null}</td>
                  <td>{o.deviceType}{o.deviceInfo ? <div className="meta muted">{o.deviceInfo}</div> : null}</td>
                  <td className="muted" style={{ maxWidth: 160 }}>{o.reportedIssue ||'—'}</td>
                  <td className="muted">{o.technicianName ||'—'}</td>
                  <td className="num">{money(woTotal(o))}</td>
                  <td><span className={`badge ${STATUS[o.status]?.cls ||'gray'}`}>{STATUS[o.status]?.label || o.status}</span></td>
                  <td style={{ display:'flex', gap: 4, flexWrap:'wrap' }}>
                    {FLOW.includes(o.status) && (
                      <select className="input" style={{ fontSize: 11, padding:'2px 4px', maxWidth: 110 }} value={o.status} onChange={(e) => setStatus(o, e.target.value)}>
                        {FLOW.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
                      </select>
                    )}
                    {o.status !=='delivered' && o.status !=='cancelled' && <button className="btn ghost sm" onClick={() => setForm({ ...o, laborCost: String(o.laborCost ||''), customerId: o.customerId ||'' })}>تعديل</button>}
                    <button className="btn ghost sm" title="طباعة الإيصال" onClick={() => printWorkOrder(o)}>🖨️ إيصال</button>
                    <button className="btn ghost sm" title="إرسال الإيصال على واتساب" onClick={() => sendWhatsApp(o)}>📱 واتساب</button>
                    {o.status ==='done' && !o.invoiceId && <button className="btn accent sm" onClick={() => setPayFor(o)}>فاتورة وتسليم</button>}
                    {o.invoiceId && <button className="btn ghost sm" onClick={() => nav(`/invoices/${o.invoiceId}`)}>الفاتورة</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <Modal title={form.id ?`تعديل أمر ${form.number}` :'أمر صيانة جديد'} onClose={() => setForm(null)}>
          <div className="row">
            <div className="field"><label>العميل (من المسجّلين)</label>
              <select className="input" value={form.customerId} onChange={(e) => pickCustomer(e.target.value)}>
                <option value="">نقدي / جديد</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
            <div className="field"><label>الفني</label>
              <select className="input" value={form.technicianName} onChange={(e) => setForm({ ...form, technicianName: e.target.value })}>
                <option value="">—</option>
                {employees.map((e) => <option key={e.id} value={e.name}>{e.name}</option>)}
              </select></div>
          </div>
          <div className="row">
            <div className="field"><label>اسم العميل</label>
              <input className="input" value={form.customerName ||''} onChange={(e) => setForm({ ...form, customerName: e.target.value })} placeholder="اسم صاحب الجهاز" /></div>
            <div className="field"><label>رقم الموبايل</label>
              <input className="input" inputMode="tel" value={form.customerPhone ||''} onChange={(e) => setForm({ ...form, customerPhone: e.target.value })} placeholder="01xxxxxxxxx" /></div>
          </div>
          <div className="row">
            <div className="field"><label>نوع الجهاز/الأصل *</label>
              <input className="input" value={form.deviceType} autoFocus onChange={(e) => setForm({ ...form, deviceType: e.target.value })} placeholder="موبايل / سيارة / مكيف / لابتوب..." /></div>
            <div className="field"><label>الموديل / السيريال</label>
              <div style={{ display:'flex', gap: 6 }}>
                <input className="input" style={{ flex: 1 }} value={form.deviceInfo} onChange={(e) => setForm({ ...form, deviceInfo: e.target.value })} placeholder="امسح السيريال أو اكتبه" />
                <button type="button" className="btn ghost" title="مسح السيريال بالكاميرا أو جهاز الاسكان" onClick={() => setScanning(true)}> مسح</button>
              </div></div>
          </div>
          <div className="field"><label>العطل / المطلوب</label>
            <textarea className="input" rows="2" value={form.reportedIssue} onChange={(e) => setForm({ ...form, reportedIssue: e.target.value })} /></div>

          <div className="field">
            <label>قطع الغيار المستخدمة</label>
            <PartPicker items={items} branch={activeBranch} onPick={(it) => setForm((f) => f.parts.find((p) => p.itemId === it.id) ? f : ({ ...f, parts: [...f.parts, { itemId: it.id, name: it.name, code: it.code, qty: 1, price: it.salePrice || 0, cost: it.costPrice || 0 }] }))} />
            {form.parts.length > 0 && (
              <div className="table-wrap" style={{ marginTop: 6 }}>
                <table><thead><tr><th>القطعة</th><th>كمية</th><th>سعر</th><th></th></tr></thead>
                  <tbody>
                    {form.parts.map((p, i) => (
                      <tr key={p.itemId}>
                        <td>{p.name}</td>
                        <td style={{ maxWidth: 70 }}><input className="input" type="number" min="0" value={p.qty} onChange={(e) => { const parts = [...form.parts]; parts[i] = { ...p, qty: Number(e.target.value) }; setForm({ ...form, parts }); }} /></td>
                        <td style={{ maxWidth: 90 }}><input className="input" type="number" min="0" value={p.price} onChange={(e) => { const parts = [...form.parts]; parts[i] = { ...p, price: Number(e.target.value) }; setForm({ ...form, parts }); }} /></td>
                        <td><button className="x" onClick={() => setForm({ ...form, parts: form.parts.filter((_, x) => x !== i) })}></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="row">
            <div className="field"><label>أجر الصيانة / العمالة</label>
              <input className="input" type="number" min="0" value={form.laborCost} onChange={(e) => setForm({ ...form, laborCost: e.target.value })} placeholder="0" /></div>
            <div className="field"><label>الضمان</label>
              <input className="input" value={form.warranty} onChange={(e) => setForm({ ...form, warranty: e.target.value })} placeholder="مثال: 3 شهور على الإصلاح" /></div>
          </div>
          <p className="muted">الإجمالي المتوقع: <b>{money((form.parts.reduce((s, p) => s + (Number(p.qty) || 0) * (Number(p.price) || 0), 0)) + (Number(form.laborCost) || 0))}</b></p>
          <button className="btn accent block" onClick={save} disabled={!form.deviceType.trim()}> حفظ</button>
        </Modal>
      )}

      {payFor && (
        <Modal title={`فاتورة وتسليم — ${payFor.number}`} onClose={() => setPayFor(null)}>
          <p className="muted">إجمالي الأمر: <b>{money(woTotal(payFor))}</b> (قطع {money(partsTotal(payFor))} + أجر {money(payFor.laborCost || 0)})</p>
          <p className="muted" style={{ fontSize: 12 }}>سيتم خصم قطع الغيار من المخزون وإنشاء فاتورة بيع وتسجيلها في المحاسبة.</p>
          <PayBox total={woTotal(payFor)} onConfirm={doInvoice} />
        </Modal>
      )}

      {scanning && (
        <BarcodeScanner
          title=" مسح سيريال الجهاز"
          onDetected={(code) => { setForm((f) => (f ? { ...f, deviceInfo: code } : f)); setScanning(false); notify(' تم قراءة السيريال'); }}
          onClose={() => setScanning(false)}
        />
      )}

      <Toast msg={toast} />
    </>
  );
}

function PayBox({ total, onConfirm }) {
  const [paid, setPaid] = useState(String(total));
  return (
    <>
      <div className="field"><label>المدفوع من العميل</label>
        <input className="input lg" type="number" min="0" value={paid} onChange={(e) => setPaid(e.target.value)} /></div>
      <button className="btn accent block" onClick={() => onConfirm(paid)}> إصدار الفاتورة والتسليم</button>
    </>
  );
}

function PartPicker({ items, branch, onPick }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const results = useMemo(() => {
    const t = normAr(q);
    if (!t) return [];
    return items.filter((it) => normAr(it.name).includes(t) || normAr(it.code).includes(t)).slice(0, 8);
  }, [q, items]);
  return (
    <div style={{ position:'relative' }}>
      <input className="input" value={q} placeholder="أضف قطعة غيار..." onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
      {open && results.length > 0 && (
        <div className="search-drop">
          {results.map((it) => (
            <div key={it.id} className="search-item" onClick={() => { onPick(it); setQ(''); setOpen(false); }}>
              <div><b>{it.name}</b><div className="meta">{it.code}</div></div>
              <div style={{ textAlign:'left' }}><b className="num">{money(it.salePrice || 0)}</b><div className="meta">رصيد: {fmt(stockOf(it, branch))}</div></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
