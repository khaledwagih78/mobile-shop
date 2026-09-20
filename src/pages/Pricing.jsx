import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, nowISO, today, queueSync } from '../db';
import { money, fmt, normAr } from '../utils';
import { Modal, Toast } from '../components/UI';

export default function Pricing() {
  const [tab, setTab] = useState('lists');
  const lists = useLiveQuery(() => db.priceLists.toArray(), [], []);
  const coupons = useLiveQuery(() => db.coupons.orderBy('createdAt').reverse().toArray(), [], []);
  const items = useLiveQuery(() => db.items.orderBy('name').toArray(), [], []);
  const customers = useLiveQuery(() => db.customers.toArray(), [], []);
  const [editList, setEditList] = useState(null);
  const [couponForm, setCouponForm] = useState(null);
  const [toast, setToast] = useState('');
  const notify = (m) => { setToast(m); setTimeout(() => setToast(''), 2500); };

  const custCountByList = useMemo(() => {
    const m = {};
    for (const c of customers) if (c.priceListId) m[c.priceListId] = (m[c.priceListId] || 0) + 1;
    return m;
  }, [customers]);

  const newList = async () => {
    const name = prompt('اسم قائمة الأسعار (مثال: أسعار الجملة / كبار العملاء):');
    if (!name) return;
    const doc = { name: name.trim(), prices: {}, createdAt: nowISO() };
    const id = await db.priceLists.add(doc);
    await queueSync('priceLists', 'add', { ...doc, id });
    setEditList(await db.priceLists.get(id));
  };

  const removeList = async (l) => {
    if (!confirm(`حذف قائمة "${l.name}"؟ العملاء المرتبطون بها هيرجعوا للسعر الأساسي.`)) return;
    await db.priceLists.delete(l.id);
    await queueSync('priceLists', 'delete', { id: l.id });
  };

  const saveCoupon = async () => {
    const doc = {
      code: couponForm.code.trim().toUpperCase(), type: couponForm.type, value: Number(couponForm.value) || 0,
      minTotal: Number(couponForm.minTotal) || 0, maxUses: Number(couponForm.maxUses) || 0,
      expiry: couponForm.expiry || null, active: couponForm.active !== false, uses: couponForm.uses || 0,
    };
    if (!doc.code) return;
    if (couponForm.id) {
      await db.coupons.update(couponForm.id, doc);
      await queueSync('coupons', 'update', { ...doc, id: couponForm.id });
    } else {
      doc.createdAt = nowISO();
      const id = await db.coupons.add(doc);
      await queueSync('coupons', 'add', { ...doc, id });
    }
    notify('✅ تم حفظ الكوبون');
    setCouponForm(null);
  };

  const removeCoupon = async (c) => {
    if (!confirm(`حذف الكوبون ${c.code}؟`)) return;
    await db.coupons.delete(c.id);
    await queueSync('coupons', 'delete', { id: c.id });
  };

  return (
    <>
      <div className="page-head"><h1>🏷️ قوائم الأسعار والكوبونات</h1></div>

      <div className="list-tools">
        <button className={`btn ${tab === 'lists' ? '' : 'ghost'}`} onClick={() => setTab('lists')}>📋 قوائم الأسعار</button>
        <button className={`btn ${tab === 'coupons' ? '' : 'ghost'}`} onClick={() => setTab('coupons')}>🎟️ الكوبونات</button>
      </div>

      {/* Price lists */}
      {tab === 'lists' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '8px 0' }}>
            <button className="btn accent" onClick={newList}>＋ قائمة أسعار</button>
          </div>
          {lists.length === 0 ? (
            <div className="card empty"><div className="big-ico">📋</div><p>لا توجد قوائم أسعار — أنشئ قائمة وحدّد أسعار خاصة، ثم اربطها بعميل من صفحة العملاء</p></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>الاسم</th><th>أصناف مسعّرة</th><th>عملاء مرتبطون</th><th></th></tr></thead>
                <tbody>
                  {lists.map((l) => (
                    <tr key={l.id}>
                      <td><b>{l.name}</b></td>
                      <td className="num">{Object.keys(l.prices || {}).length}</td>
                      <td className="num">{custCountByList[l.id] || 0}</td>
                      <td style={{ display: 'flex', gap: 6 }}>
                        <button className="btn ghost sm" onClick={() => setEditList(l)}>تحديد الأسعار</button>
                        <button className="btn danger sm" onClick={() => removeList(l)}>حذف</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>💡 لربط القائمة بعميل: صفحة العملاء ← تعديل العميل ← اختر قائمة الأسعار. وقتها الفاتورة بتستخدم أسعار القائمة تلقائياً.</p>
        </>
      )}

      {/* Coupons */}
      {tab === 'coupons' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '8px 0' }}>
            <button className="btn accent" onClick={() => setCouponForm({ code: '', type: 'percent', value: '', minTotal: '', maxUses: '', expiry: '', active: true })}>＋ كوبون</button>
          </div>
          {coupons.length === 0 ? (
            <div className="card empty"><div className="big-ico">🎟️</div><p>لا توجد كوبونات — أنشئ كوبون خصم يُطبّق عند البيع</p></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>الكود</th><th>الخصم</th><th>حد أدنى</th><th>الاستخدام</th><th>الصلاحية</th><th>الحالة</th><th></th></tr></thead>
                <tbody>
                  {coupons.map((c) => (
                    <tr key={c.id}>
                      <td><b className="num">{c.code}</b></td>
                      <td>{c.type === 'percent' ? `${fmt(c.value)}%` : money(c.value)}</td>
                      <td className="num muted">{c.minTotal ? money(c.minTotal) : '—'}</td>
                      <td className="num muted">{c.uses || 0}{c.maxUses ? ` / ${c.maxUses}` : ''}</td>
                      <td className="muted">{c.expiry || '—'}</td>
                      <td>{c.active !== false ? <span className="badge green">مفعّل</span> : <span className="badge gray">موقوف</span>}</td>
                      <td style={{ display: 'flex', gap: 6 }}>
                        <button className="btn ghost sm" onClick={() => setCouponForm({ ...c, value: String(c.value), minTotal: String(c.minTotal || ''), maxUses: String(c.maxUses || '') })}>تعديل</button>
                        <button className="btn danger sm" onClick={() => removeCoupon(c)}>حذف</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {editList && <PriceListEditor list={editList} items={items} onClose={() => setEditList(null)} notify={notify} />}

      {couponForm && (
        <Modal title={couponForm.id ? `تعديل: ${couponForm.code}` : 'كوبون جديد'} onClose={() => setCouponForm(null)}>
          <div className="row">
            <div className="field"><label>الكود *</label>
              <input className="input" value={couponForm.code} autoFocus onChange={(e) => setCouponForm({ ...couponForm, code: e.target.value })} placeholder="SUMMER20" /></div>
            <div className="field"><label>النوع</label>
              <select className="input" value={couponForm.type} onChange={(e) => setCouponForm({ ...couponForm, type: e.target.value })}>
                <option value="percent">نسبة %</option>
                <option value="fixed">مبلغ ثابت</option>
              </select></div>
            <div className="field"><label>القيمة *</label>
              <input className="input" type="number" min="0" value={couponForm.value} onChange={(e) => setCouponForm({ ...couponForm, value: e.target.value })} /></div>
          </div>
          <div className="row">
            <div className="field"><label>حد أدنى للفاتورة</label>
              <input className="input" type="number" min="0" value={couponForm.minTotal} onChange={(e) => setCouponForm({ ...couponForm, minTotal: e.target.value })} placeholder="0" /></div>
            <div className="field"><label>أقصى عدد استخدامات</label>
              <input className="input" type="number" min="0" value={couponForm.maxUses} onChange={(e) => setCouponForm({ ...couponForm, maxUses: e.target.value })} placeholder="0 = غير محدود" /></div>
            <div className="field"><label>تاريخ الانتهاء</label>
              <input className="input" type="date" value={couponForm.expiry || ''} onChange={(e) => setCouponForm({ ...couponForm, expiry: e.target.value })} /></div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0', cursor: 'pointer' }}>
            <input type="checkbox" checked={couponForm.active !== false} onChange={(e) => setCouponForm({ ...couponForm, active: e.target.checked })} /> مفعّل
          </label>
          <button className="btn block" onClick={saveCoupon} disabled={!couponForm.code.trim() || !(Number(couponForm.value) > 0)}>💾 حفظ</button>
        </Modal>
      )}

      <Toast msg={toast} />
    </>
  );
}

function PriceListEditor({ list, items, onClose, notify }) {
  const [q, setQ] = useState('');
  const [prices, setPrices] = useState({ ...(list.prices || {}) });
  const filtered = useMemo(() => {
    const t = normAr(q);
    return (t ? items.filter((it) => normAr(it.name).includes(t) || normAr(it.code).includes(t)) : items).slice(0, 60);
  }, [q, items]);

  const save = async () => {
    const clean = {};
    for (const [k, v] of Object.entries(prices)) if (Number(v) > 0) clean[k] = Number(v);
    await db.priceLists.update(list.id, { prices: clean });
    await queueSync('priceLists', 'update', { id: list.id, prices: clean });
    notify('✅ تم حفظ الأسعار');
    onClose();
  };

  return (
    <Modal title={`أسعار: ${list.name}`} onClose={onClose}>
      <input className="input" placeholder="🔍 بحث عن صنف..." value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 8 }} />
      <div className="table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
        <table>
          <thead><tr><th>الصنف</th><th>السعر الأساسي</th><th>سعر القائمة</th></tr></thead>
          <tbody>
            {filtered.map((it) => (
              <tr key={it.id}>
                <td>{it.name}<div className="meta muted">{it.code}</div></td>
                <td className="num muted">{money(it.salePrice)}</td>
                <td style={{ maxWidth: 120 }}>
                  <input className="input" type="number" min="0" value={prices[it.id] ?? ''} placeholder="—"
                    onChange={(e) => setPrices((p) => ({ ...p, [it.id]: e.target.value }))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn accent block" style={{ marginTop: 10 }} onClick={save}>💾 حفظ القائمة</button>
    </Modal>
  );
}
