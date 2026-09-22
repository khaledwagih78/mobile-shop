import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db, today, queueSync, createWorkOrder, invoiceWorkOrder, stockOf } from '../db';
import { money, fmt, normAr } from '../utils';
import { Modal, Toast } from '../components/UI';
import { useAuth } from '../auth';

const STATUS = {
  received: { label: 'تم الاستلام', cls: 'gray' },
  in_progress: { label: 'تحت الصيانة', cls: 'amber' },
  done: { label: 'تم الإصلاح', cls: 'accent' },
  delivered: { label: 'تم التسليم', cls: 'green' },
  cancelled: { label: 'ملغي', cls: 'red' },
};
const FLOW = ['received', 'in_progress', 'done'];

export default function WorkOrders() {
  const { user, activeBranch } = useAuth();
  const nav = useNavigate();
  const orders = useLiveQuery(() => db.workOrders.orderBy('createdAt').reverse().toArray(), [], []);
  const customers = useLiveQuery(() => db.customers.toArray(), [], []);
  const employees = useLiveQuery(() => db.employees.where('status').equals('active').toArray(), [], []);
  const items = useLiveQuery(() => db.items.toArray(), [], []);
  const [form, setForm] = useState(null);
  const [payFor, setPayFor] = useState(null);
  const [filter, setFilter] = useState('open');
  const [toast, setToast] = useState('');
  const notify = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const filtered = useMemo(() => {
    if (filter === 'all') return orders;
    if (filter === 'open') return orders.filter((o) => o.status !== 'delivered' && o.status !== 'cancelled');
    return orders.filter((o) => o.status === filter);
  }, [orders, filter]);

  const openNew = () => setForm({ customerId: '', customerName: '', deviceType: '', deviceInfo: '', reportedIssue: '', technicianName: '', parts: [], laborCost: '', warranty: '', notes: '', status: 'received' });

  const save = async () => {
    const cust = customers.find((c) => c.id === Number(form.customerId));
    const payload = {
      customerId: cust ? cust.id : null, customerName: cust ? cust.name : (form.customerName || ''),
      deviceType: form.deviceType, deviceInfo: form.deviceInfo, reportedIssue: form.reportedIssue,
      technicianName: form.technicianName, parts: form.parts, laborCost: Number(form.laborCost) || 0,
      warranty: form.warranty, notes: form.notes, status: form.status, branchId: activeBranch,
    };
    if (form.id) {
      await db.workOrders.update(form.id, payload);
      await queueSync('workOrders', 'update', { ...payload, id: form.id });
    } else {
      await createWorkOrder(payload);
    }
    notify('✅ تم حفظ أمر الصيانة');
    setForm(null);
  };

  const setStatus = async (o, status) => {
    await db.workOrders.update(o.id, { status });
    await queueSync('workOrders', 'update', { id: o.id, status });
  };

  const doInvoice = async (paid) => {
    const res = await invoiceWorkOrder(payFor.id, { paid: paid === '' ? null : Number(paid), userName: user.name });
    setPayFor(null);
    if (res) nav(`/invoices/${res.id}?new=1`);
  };

  const partsTotal = (o) => (o.parts || []).reduce((s, p) => s + (Number(p.qty) || 0) * (Number(p.price) || 0), 0);
  const woTotal = (o) => partsTotal(o) + (Number(o.laborCost) || 0);

  return (
    <>
      <div className="page-head">
        <h1>🔧 الصيانة وأوامر العمل</h1>
        <button className="btn accent" onClick={openNew}>＋ أمر صيانة</button>
      </div>

      <div className="list-tools">
        {['open', 'received', 'in_progress', 'done', 'delivered', 'all'].map((f) => (
          <button key={f} className={`btn ${filter === f ? '' : 'ghost'} sm`} onClick={() => setFilter(f)}>
            {f === 'open' ? 'المفتوحة' : f === 'all' ? 'الكل' : STATUS[f].label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card empty"><div className="big-ico">🔧</div><p>لا توجد أوامر صيانة</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>رقم</th><th>العميل</th><th>الجهاز/الوصف</th><th>العطل</th><th>الفني</th><th>الإجمالي</th><th>الحالة</th><th></th></tr></thead>
            <tbody>
              {filtered.map((o) => (
                <tr key={o.id}>
                  <td className="num">{o.number}</td>
                  <td>{o.customerName || 'نقدي'}</td>
                  <td>{o.deviceType}{o.deviceInfo ? <div className="meta muted">{o.deviceInfo}</div> : null}</td>
                  <td className="muted" style={{ maxWidth: 160 }}>{o.reportedIssue || '—'}</td>
                  <td className="muted">{o.technicianName || '—'}</td>
                  <td className="num">{money(woTotal(o))}</td>
                  <td><span className={`badge ${STATUS[o.status]?.cls || 'gray'}`}>{STATUS[o.status]?.label || o.status}</span></td>
                  <td style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {FLOW.includes(o.status) && (
                      <select className="input" style={{ fontSize: 11, padding: '2px 4px', maxWidth: 110 }} value={o.status} onChange={(e) => setStatus(o, e.target.value)}>
                        {FLOW.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
                      </select>
                    )}
                    {o.status !== 'delivered' && o.status !== 'cancelled' && <button className="btn ghost sm" onClick={() => setForm({ ...o, laborCost: String(o.laborCost || ''), customerId: o.customerId || '' })}>تعديل</button>}
                    {o.status === 'done' && !o.invoiceId && <button className="btn accent sm" onClick={() => setPayFor(o)}>فاتورة وتسليم</button>}
                    {o.invoiceId && <button className="btn ghost sm" onClick={() => nav(`/invoices/${o.invoiceId}`)}>الفاتورة</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <Modal title={form.id ? `تعديل أمر ${form.number}` : 'أمر صيانة جديد'} onClose={() => setForm(null)}>
          <div className="row">
            <div className="field"><label>العميل</label>
              <select className="input" value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}>
                <option value="">نقدي / بدون</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
            <div className="field"><label>الفني</label>
              <select className="input" value={form.technicianName} onChange={(e) => setForm({ ...form, technicianName: e.target.value })}>
                <option value="">—</option>
                {employees.map((e) => <option key={e.id} value={e.name}>{e.name}</option>)}
              </select></div>
          </div>
          <div className="row">
            <div className="field"><label>نوع الجهاز/الأصل *</label>
              <input className="input" value={form.deviceType} autoFocus onChange={(e) => setForm({ ...form, deviceType: e.target.value })} placeholder="موبايل / سيارة / مكيف / لابتوب..." /></div>
            <div className="field"><label>الموديل / السيريال</label>
              <input className="input" value={form.deviceInfo} onChange={(e) => setForm({ ...form, deviceInfo: e.target.value })} /></div>
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
                        <td><button className="x" onClick={() => setForm({ ...form, parts: form.parts.filter((_, x) => x !== i) })}>✕</button></td>
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
          <button className="btn accent block" onClick={save} disabled={!form.deviceType.trim()}>💾 حفظ</button>
        </Modal>
      )}

      {payFor && (
        <Modal title={`فاتورة وتسليم — ${payFor.number}`} onClose={() => setPayFor(null)}>
          <p className="muted">إجمالي الأمر: <b>{money(woTotal(payFor))}</b> (قطع {money(partsTotal(payFor))} + أجر {money(payFor.laborCost || 0)})</p>
          <p className="muted" style={{ fontSize: 12 }}>سيتم خصم قطع الغيار من المخزون وإنشاء فاتورة بيع وتسجيلها في المحاسبة.</p>
          <PayBox total={woTotal(payFor)} onConfirm={doInvoice} />
        </Modal>
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
      <button className="btn accent block" onClick={() => onConfirm(paid)}>✅ إصدار الفاتورة والتسليم</button>
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
    <div style={{ position: 'relative' }}>
      <input className="input" value={q} placeholder="🔍 أضف قطعة غيار..." onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
      {open && results.length > 0 && (
        <div className="search-drop">
          {results.map((it) => (
            <div key={it.id} className="search-item" onClick={() => { onPick(it); setQ(''); setOpen(false); }}>
              <div><b>{it.name}</b><div className="meta">{it.code}</div></div>
              <div style={{ textAlign: 'left' }}><b className="num">{money(it.salePrice || 0)}</b><div className="meta">رصيد: {fmt(stockOf(it, branch))}</div></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
