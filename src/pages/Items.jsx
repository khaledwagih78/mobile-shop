import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, nowISO, queueSync, getSetting } from '../db';
import { money, fmt, fmtDate, can, marginPct } from '../utils';
import { useAuth } from '../auth';
import { Modal } from '../components/UI';

const EMPTY = { code: '', barcode: '', name: '', brand: '', category: '', costUSD: '', costPrice: '', salePrice: '', minStock: '', stock: '' };

export default function Items() {
  const { user } = useAuth();
  const items = useLiveQuery(() => db.items.orderBy('name').toArray(), [], []);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [form, setForm] = useState(null); // null | {…item}
  const [movesFor, setMovesFor] = useState(null);
  const editable = can(user.role, 'editItem');
  const usdRate = useLiveQuery(() => getSetting('usdRate', 0), [], 0);
  const defMargin = useLiveQuery(() => getSetting('defaultMargin', 0), [], 0);

  const onUsdChange = (v) => {
    const patch = { costUSD: v };
    const usd = Number(v);
    if (usd > 0 && Number(usdRate) > 0) {
      patch.costPrice = Math.round(usd * Number(usdRate) * 100) / 100;
      if (Number(defMargin) > 0) patch.salePrice = Math.round(patch.costPrice * (1 + Number(defMargin) / 100));
    }
    setForm((f) => ({ ...f, ...patch }));
  };

  const reprice = async () => {
    const rate = Number(usdRate);
    if (!rate) return alert('حددي سعر صرف الدولار في صفحة الإعدادات أولاً');
    const usdItems = items.filter((it) => (it.costUSD || 0) > 0);
    if (!usdItems.length) return alert('لا توجد أصناف مسجّل لها تكلفة بالدولار بعد');
    if (!confirm(`سيتم تحديث سعر الشراء لـ ${usdItems.length} صنف بسعر صرف ${rate} ج.م للدولار. متابعة؟`)) return;
    const updSale = Number(defMargin) > 0 && confirm(`تحديث سعر البيع أيضاً بنسبة ربح ${defMargin}%؟`);
    for (const it of usdItems) {
      const costPrice = Math.round(it.costUSD * rate * 100) / 100;
      const patch = { costPrice };
      if (updSale) patch.salePrice = Math.round(costPrice * (1 + Number(defMargin) / 100));
      await db.items.update(it.id, patch);
    }
    await queueSync('items', 'reprice', { rate, count: usdItems.length });
    alert(`✅ تم تحديث أسعار ${usdItems.length} صنف`);
  };

  const list = useMemo(() => {
    let l = items;
    const t = q.trim().toLowerCase();
    if (t) l = l.filter((it) =>
      (it.name || '').toLowerCase().includes(t) ||
      (it.code || '').toLowerCase().includes(t) ||
      (it.barcode || '').includes(t) ||
      (it.brand || '').toLowerCase().includes(t)
    );
    if (filter === 'low') l = l.filter((it) => (it.stock || 0) <= (it.minStock || 0));
    return l;
  }, [items, q, filter]);

  const saveItem = async () => {
    const doc = {
      ...form,
      costUSD: Number(form.costUSD) || 0,
      costPrice: Number(form.costPrice) || 0,
      salePrice: Number(form.salePrice) || 0,
      minStock: Number(form.minStock) || 0,
      stock: Number(form.stock) || 0,
    };
    if (form.id) {
      await db.items.update(form.id, doc);
      await queueSync('items', 'update', doc);
    } else {
      const id = await db.items.add({ ...doc, createdAt: nowISO() });
      await queueSync('items', 'add', { ...doc, id });
    }
    setForm(null);
  };

  const lowCount = items.filter((it) => (it.stock || 0) <= (it.minStock || 0)).length;

  return (
    <>
      <div className="page-head">
        <h1>📦 المخزون <span className="muted" style={{ fontSize: 14 }}>({items.length} صنف)</span></h1>
        {editable && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn ghost" onClick={reprice}>💱 إعادة التسعير بالدولار</button>
            <button className="btn" onClick={() => setForm({ ...EMPTY })}>＋ صنف جديد</button>
          </div>
        )}
      </div>

      <div className="list-tools">
        <input className="input" placeholder="بحث بالاسم / الكود / الباركود / الماركة..." value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" style={{ maxWidth: 190 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">كل الأصناف</option>
          <option value="low">⚠️ نواقص ({lowCount})</option>
        </select>
      </div>

      {list.length === 0 ? (
        <div className="card empty"><div className="big-ico">📦</div><p>لا توجد أصناف{editable ? ' — أضف أول صنف' : ''}</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>الكود</th><th>الصنف</th><th>الماركة</th><th>النوع</th><th>شراء</th><th>بيع</th><th>ربح %</th><th>الرصيد</th><th></th></tr>
            </thead>
            <tbody>
              {list.map((it) => {
                const low = (it.stock || 0) <= (it.minStock || 0);
                return (
                  <tr key={it.id}>
                    <td className="num muted">{it.code}</td>
                    <td><b>{it.name}</b></td>
                    <td>{it.brand || '—'}</td>
                    <td>{it.category || '—'}</td>
                    <td className="num">{fmt(it.costPrice)}</td>
                    <td className="num">{fmt(it.salePrice)}</td>
                    <td className="num" style={{ color: marginPct(it.costPrice, it.salePrice) < 15 ? 'var(--red)' : 'var(--green)' }}>
                      {it.costPrice > 0 ? marginPct(it.costPrice, it.salePrice) + '%' : '—'}
                    </td>
                    <td>
                      <span className={`badge ${low ? 'red' : 'green'}`}>{fmt(it.stock)}</span>
                    </td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      <button className="btn ghost sm" onClick={() => setMovesFor(it)}>حركة</button>
                      {editable && <button className="btn ghost sm" onClick={() => setForm({ ...it })}>تعديل</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <Modal title={form.id ? `تعديل: ${form.name}` : 'صنف جديد'} onClose={() => setForm(null)}>
          <div className="row">
            <div className="field"><label>كود الصنف</label>
              <input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
            <div className="field"><label>الباركود</label>
              <input className="input" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} /></div>
          </div>
          <div className="field"><label>اسم الصنف *</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="row">
            <div className="field"><label>الماركة</label>
              <input className="input" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></div>
            <div className="field"><label>النوع</label>
              <input className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="شاشات / بطاريات..." /></div>
          </div>
          <div className="row">
            <div className="field"><label>التكلفة بالدولار $ (اختياري)</label>
              <input className="input" type="number" min="0" step="0.01" value={form.costUSD || ''} onChange={(e) => onUsdChange(e.target.value)}
                placeholder={Number(usdRate) > 0 ? `سعر الصرف: ${usdRate}` : 'حددي سعر الصرف في الإعدادات'} /></div>
            <div className="field"><label>سعر الشراء</label>
              <input className="input" type="number" min="0" value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} /></div>
            <div className="field"><label>سعر البيع</label>
              <input className="input" type="number" min="0" value={form.salePrice} onChange={(e) => setForm({ ...form, salePrice: e.target.value })} /></div>
          </div>
          <div className="row">
            <div className="field"><label>الرصيد الحالي</label>
              <input className="input" type="number" min="0" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} /></div>
            <div className="field"><label>الحد الأدنى للتنبيه</label>
              <input className="input" type="number" min="0" value={form.minStock} onChange={(e) => setForm({ ...form, minStock: e.target.value })} /></div>
          </div>
          <button className="btn block" onClick={saveItem} disabled={!form.name.trim()}>💾 حفظ</button>
        </Modal>
      )}

      {movesFor && <MovesModal item={movesFor} onClose={() => setMovesFor(null)} />}
    </>
  );
}

function MovesModal({ item, onClose }) {
  const moves = useLiveQuery(
    () => db.stockMoves.where('itemId').equals(item.id).sortBy('createdAt').then((a) => a.reverse()),
    [item.id], []
  );
  // compute running balance backwards from current stock
  let bal = item.stock || 0;
  const rows = moves.map((m) => {
    const row = { ...m, balance: bal };
    bal += m.direction === 'in' ? -m.qty : m.qty;
    return row;
  });
  return (
    <Modal title={`حركة الصنف: ${item.name}`} onClose={onClose}>
      <p className="muted">الرصيد الحالي: <b>{fmt(item.stock)}</b> · التكلفة: {money(item.costPrice)}</p>
      {rows.length === 0 ? (
        <div className="empty">لا توجد حركة بعد</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>الحركة</th><th>الكمية</th><th>الرصيد</th><th>المرجع</th><th>التاريخ</th></tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td>{m.direction === 'in' ? <span className="badge green">دخل</span> : <span className="badge red">خرج</span>}</td>
                  <td className="num">{fmt(m.qty)}</td>
                  <td className="num">{fmt(m.balance)}</td>
                  <td className="muted">{m.refNumber}{m.refType === 'cancel' ? ' (إلغاء)' : ''}</td>
                  <td className="muted">{fmtDate(m.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
