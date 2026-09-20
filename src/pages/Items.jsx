import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, nowISO, queueSync, getSetting, stockOf, getCustomFields } from '../db';
import { money, fmt, fmtDate, can, marginPct, genBarcode } from '../utils';
import { useAuth } from '../auth';
import { Modal } from '../components/UI';
import { Barcode, barcodeSVG } from '../components/Barcode';
import { CustomFieldInputs } from './CustomFields';

const EMPTY = { code: '', barcode: '', name: '', brand: '', category: '', costUSD: '', costPrice: '', salePrice: '', wholesalePrice: '', wholesaleMinQty: '', minStock: '', stock: '', baseUnit: 'قطعة', units: [], taxable: true, expiry: '', batch: '' };

export default function Items() {
  const { user, activeBranch, branches } = useAuth();
  const items = useLiveQuery(() => db.items.orderBy('name').toArray(), [], []);
  const st = (it) => stockOf(it, activeBranch); // qty at the active branch
  const branchName = branches.find((b) => b.id === activeBranch)?.name || 'الفرع';
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [brandFilter, setBrandFilter] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [priceFrom, setPriceFrom] = useState('');
  const [priceTo, setPriceTo] = useState('');
  const [sortField, setSortField] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [form, setForm] = useState(null);
  const [movesFor, setMovesFor] = useState(null);
  const [labelFor, setLabelFor] = useState(null);
  const [showPricer, setShowPricer] = useState(false);
  const editable = can(user.role, 'editItem');
  const usdRate = useLiveQuery(() => getSetting('usdRate', 0), [], 0);
  const defMargin = useLiveQuery(() => getSetting('defaultMargin', 0), [], 0);
  const customFields = useLiveQuery(() => getCustomFields('item'), [], []);

  const brands = useMemo(() => [...new Set(items.map((it) => it.brand).filter(Boolean))].sort(), [items]);
  const categories = useMemo(() => [...new Set(items.map((it) => it.category).filter(Boolean))].sort(), [items]);

  const onUsdChange = (v) => {
    const patch = { costUSD: v };
    const usd = Number(v);
    if (usd > 0 && Number(usdRate) > 0) {
      patch.costPrice = Math.round(usd * Number(usdRate) * 100) / 100;
      if (Number(defMargin) > 0) {
        patch.salePrice = Math.round(patch.costPrice * (1 + Number(defMargin) / 100));
        patch.wholesalePrice = Math.round(patch.costPrice * (1 + (Number(defMargin) * 0.6) / 100));
      }
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
      if (updSale) {
        patch.salePrice = Math.round(costPrice * (1 + Number(defMargin) / 100));
        patch.wholesalePrice = Math.round(costPrice * (1 + (Number(defMargin) * 0.6) / 100));
      }
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
    if (filter === 'low') l = l.filter((it) => st(it) <= (it.minStock || 0));
    if (brandFilter) l = l.filter((it) => it.brand === brandFilter);
    if (catFilter) l = l.filter((it) => it.category === catFilter);
    if (priceFrom) l = l.filter((it) => (it.salePrice || 0) >= Number(priceFrom));
    if (priceTo) l = l.filter((it) => (it.salePrice || 0) <= Number(priceTo));

    l.sort((a, b) => {
      const va = sortField === 'stock' ? st(a) : (a[sortField] || '');
      const vb = sortField === 'stock' ? st(b) : (b[sortField] || '');
      if (typeof va === 'number') return sortDir === 'asc' ? va - vb : vb - va;
      return sortDir === 'asc' ? String(va).localeCompare(String(vb), 'ar') : String(vb).localeCompare(String(va), 'ar');
    });
    return l;
  }, [items, q, filter, brandFilter, catFilter, priceFrom, priceTo, sortField, sortDir, activeBranch]);

  const toggleSort = (field) => {
    if (sortField === field) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };
  const sortIcon = (field) => sortField === field ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  const saveItem = async () => {
    const stockVal = Number(form.stock) || 0;
    const { stock, ...fields } = form;
    const base = {
      ...fields,
      baseUnit: (form.baseUnit || 'قطعة').trim() || 'قطعة',
      units: (form.units || []).filter((u) => u.name && Number(u.factor) > 1).map((u) => ({ name: u.name.trim(), factor: Number(u.factor) })),
      costUSD: Number(form.costUSD) || 0,
      costPrice: Number(form.costPrice) || 0,
      salePrice: Number(form.salePrice) || 0,
      wholesalePrice: Number(form.wholesalePrice) || 0,
      wholesaleMinQty: Number(form.wholesaleMinQty) || 0,
      minStock: Number(form.minStock) || 0,
      taxable: form.taxable !== false,
    };
    if (form.id) {
      const existing = await db.items.get(form.id);
      const stocks = { ...(existing?.stocks || {}), [activeBranch]: stockVal };
      const doc = { ...base, stocks };
      await db.items.update(form.id, doc);
      await queueSync('items', 'update', doc);
    } else {
      const doc = { ...base, stocks: { [activeBranch]: stockVal } };
      const id = await db.items.add({ ...doc, createdAt: nowISO() });
      await queueSync('items', 'add', { ...doc, id });
    }
    setForm(null);
  };

  const lowCount = items.filter((it) => st(it) <= (it.minStock || 0)).length;

  return (
    <>
      <div className="page-head">
        <h1>📦 المخزون <span className="muted" style={{ fontSize: 14 }}>({items.length} صنف — {list.length} ظاهر)</span></h1>
        {editable && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn ghost" onClick={() => setShowPricer(true)}>💹 تعديل الأسعار %</button>
            <button className="btn ghost" onClick={reprice}>💱 إعادة التسعير بالدولار</button>
            <button className="btn" onClick={() => setForm({ ...EMPTY })}>＋ صنف جديد</button>
          </div>
        )}
      </div>

      <div className="list-tools">
        <input className="input" placeholder="🔍 بحث بالاسم / الكود / الباركود / الماركة..." value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" style={{ maxWidth: 160 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">كل الأصناف</option>
          <option value="low">⚠️ نواقص ({lowCount})</option>
        </select>
        <select className="input" style={{ maxWidth: 140 }} value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)}>
          <option value="">كل الماركات</option>
          {brands.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <select className="input" style={{ maxWidth: 140 }} value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
          <option value="">كل الأنواع</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input className="input" style={{ maxWidth: 90 }} type="number" min="0" placeholder="سعر من" value={priceFrom} onChange={(e) => setPriceFrom(e.target.value)} />
        <input className="input" style={{ maxWidth: 90 }} type="number" min="0" placeholder="سعر لـ" value={priceTo} onChange={(e) => setPriceTo(e.target.value)} />
      </div>

      {list.length === 0 ? (
        <div className="card empty"><div className="big-ico">📦</div><p>لا توجد أصناف{editable ? ' — أضف أول صنف' : ''}</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="clickable" onClick={() => toggleSort('code')}>الكود{sortIcon('code')}</th>
                <th className="clickable" onClick={() => toggleSort('name')}>الصنف{sortIcon('name')}</th>
                <th className="clickable" onClick={() => toggleSort('brand')}>الماركة{sortIcon('brand')}</th>
                <th>النوع</th>
                <th className="clickable" onClick={() => toggleSort('costPrice')}>شراء{sortIcon('costPrice')}</th>
                <th className="clickable" onClick={() => toggleSort('salePrice')}>بيع{sortIcon('salePrice')}</th>
                <th>جملة</th>
                <th>ربح %</th>
                <th className="clickable" onClick={() => toggleSort('stock')}>رصيد {branchName}{sortIcon('stock')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((it) => {
                const low = st(it) <= (it.minStock || 0);
                return (
                  <tr key={it.id}>
                    <td className="num muted">{it.code}</td>
                    <td><b>{it.name}</b></td>
                    <td>{it.brand || '—'}</td>
                    <td>{it.category || '—'}</td>
                    <td className="num">{fmt(it.costPrice)}</td>
                    <td className="num">{fmt(it.salePrice)}</td>
                    <td className="num muted">{it.wholesalePrice ? fmt(it.wholesalePrice) : '—'}{it.wholesaleMinQty ? <small> ({it.wholesaleMinQty}+)</small> : ''}</td>
                    <td className="num" style={{ color: marginPct(it.costPrice, it.salePrice) < 15 ? 'var(--red)' : 'var(--green)' }}>
                      {it.costPrice > 0 ? marginPct(it.costPrice, it.salePrice) + '%' : '—'}
                    </td>
                    <td>
                      <span className={`badge ${low ? 'red' : 'green'}`}>{fmt(st(it))}</span>
                    </td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      <button className="btn ghost sm" title="باركود" onClick={() => setLabelFor(it)}>🏷️</button>
                      <button className="btn ghost sm" onClick={() => setMovesFor(it)}>حركة</button>
                      {editable && <button className="btn ghost sm" onClick={() => setForm({ ...it, stock: st(it) })}>تعديل</button>}
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
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="input" style={{ flex: 1 }} value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} placeholder="امسح أو ولّد باركود" />
                <button className="btn ghost sm" type="button" title="توليد باركود جديد" onClick={() => setForm({ ...form, barcode: genBarcode() })}>🏷️ توليد</button>
              </div>
            </div>
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
            <div className="field"><label>💰 سعر الجملة</label>
              <input className="input" type="number" min="0" value={form.wholesalePrice || ''} onChange={(e) => setForm({ ...form, wholesalePrice: e.target.value })}
                placeholder="سعر مختلف للجملة" /></div>
            <div className="field"><label>الحد الأدنى لكمية الجملة</label>
              <input className="input" type="number" min="0" value={form.wholesaleMinQty || ''} onChange={(e) => setForm({ ...form, wholesaleMinQty: e.target.value })}
                placeholder="مثال: 10" /></div>
          </div>
          <div className="row">
            <div className="field"><label>الرصيد في {branchName}</label>
              <input className="input" type="number" min="0" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} /></div>
            <div className="field"><label>الحد الأدنى للتنبيه</label>
              <input className="input" type="number" min="0" value={form.minStock} onChange={(e) => setForm({ ...form, minStock: e.target.value })} /></div>
          </div>

          <div className="row">
            <div className="field"><label>📅 تاريخ الصلاحية (اختياري)</label>
              <input className="input" type="date" value={form.expiry || ''} onChange={(e) => setForm({ ...form, expiry: e.target.value })} /></div>
            <div className="field"><label>🔖 رقم التشغيلة / اللوط (اختياري)</label>
              <input className="input" value={form.batch || ''} onChange={(e) => setForm({ ...form, batch: e.target.value })} placeholder="Batch/Lot" /></div>
          </div>
          <div className="row">
            <div className="field"><label>وحدة القياس الأساسية</label>
              <input className="input" value={form.baseUnit || ''} onChange={(e) => setForm({ ...form, baseUnit: e.target.value })} placeholder="قطعة / كيلو / متر" /></div>
            <div className="field"><label>الضريبة</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '8px 0' }}>
                <input type="checkbox" checked={form.taxable !== false} onChange={(e) => setForm({ ...form, taxable: e.target.checked })} style={{ width: 18, height: 18 }} />
                خاضع للضريبة
              </label>
            </div>
          </div>
          <div className="field">
            <label>📦 وحدات أكبر (اختياري) — مثال: كرتونة تحتوي 24 قطعة</label>
            {(form.units || []).map((u, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <input className="input" style={{ flex: 1 }} placeholder="اسم الوحدة (كرتونة)" value={u.name}
                  onChange={(e) => { const units = [...form.units]; units[i] = { ...units[i], name: e.target.value }; setForm({ ...form, units }); }} />
                <input className="input" style={{ width: 130 }} type="number" min="2" placeholder="تحتوي كام؟" value={u.factor}
                  onChange={(e) => { const units = [...form.units]; units[i] = { ...units[i], factor: e.target.value }; setForm({ ...form, units }); }} />
                <button className="btn ghost sm" type="button" onClick={() => setForm({ ...form, units: form.units.filter((_, x) => x !== i) })}>✕</button>
              </div>
            ))}
            <button className="btn ghost sm" type="button" onClick={() => setForm({ ...form, units: [...(form.units || []), { name: '', factor: '' }] })}>＋ إضافة وحدة</button>
          </div>

          {customFields.length > 0 && (
            <CustomFieldInputs
              fields={customFields}
              values={form.custom}
              onChange={(fid, v) => setForm({ ...form, custom: { ...(form.custom || {}), [fid]: v } })}
            />
          )}
          <button className="btn block" onClick={saveItem} disabled={!form.name.trim()}>💾 حفظ</button>
        </Modal>
      )}

      {movesFor && <MovesModal item={movesFor} branchId={activeBranch} branchName={branchName} onClose={() => setMovesFor(null)} />}
      {labelFor && <BarcodeModal item={labelFor} onClose={() => setLabelFor(null)} />}
      {showPricer && <PriceModal list={list} onClose={() => setShowPricer(false)} />}
    </>
  );
}

function MovesModal({ item, branchId, branchName, onClose }) {
  const moves = useLiveQuery(
    () => db.stockMoves.where('itemId').equals(item.id).sortBy('createdAt')
      .then((a) => a.reverse().filter((m) => (m.branchId || 1) === branchId)),
    [item.id, branchId], []
  );
  let bal = stockOf(item, branchId);
  const rows = moves.map((m) => {
    const row = { ...m, balance: bal };
    bal += m.direction === 'in' ? -m.qty : m.qty;
    return row;
  });
  return (
    <Modal title={`حركة الصنف: ${item.name}`} onClose={onClose}>
      <p className="muted">رصيد {branchName}: <b>{fmt(stockOf(item, branchId))}</b> · التكلفة: {money(item.costPrice)}</p>
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

function BarcodeModal({ item, onClose }) {
  const value = item.barcode || item.code;
  const print = () => {
    if (!value) return;
    const svg = barcodeSVG(value);
    const w = window.open('', '_blank', 'width=420,height=340');
    if (!w) { alert('اسمح بالنوافذ المنبثقة لطباعة الملصق'); return; }
    w.document.write(
      '<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>باركود</title></head>' +
      '<body style="text-align:center;font-family:sans-serif;margin:14px">' +
      '<div style="font-weight:bold;font-size:15px">' + item.name + '</div>' +
      '<div style="font-size:14px;margin:2px 0">' + money(item.salePrice) + '</div>' +
      svg +
      '<scr' + 'ipt>window.onload=function(){window.print();}</scr' + 'ipt>' +
      '</body></html>'
    );
    w.document.close();
  };
  return (
    <Modal title={`باركود: ${item.name}`} onClose={onClose}>
      {value ? (
        <div style={{ textAlign: 'center' }}>
          <Barcode value={value} height={70} />
          <div className="muted" style={{ marginTop: 4 }}>سعر البيع: {money(item.salePrice)}</div>
          <button className="btn block" style={{ marginTop: 12 }} onClick={print}>🖨️ طباعة الملصق</button>
        </div>
      ) : (
        <div className="empty">لا يوجد باركود لهذا الصنف — افتح "تعديل" واضغط "🏷️ توليد".</div>
      )}
    </Modal>
  );
}

function PriceModal({ list, onClose }) {
  const [dir, setDir] = useState('up');
  const [pct, setPct] = useState('');
  const [target, setTarget] = useState('sale');
  const [done, setDone] = useState(0);

  const apply = async () => {
    const p = Number(pct);
    if (!p || p <= 0) return;
    if (!confirm(`تأكيد: ${dir === 'up' ? 'زيادة' : 'خفض'} الأسعار بنسبة ${p}% على ${list.length} صنف؟`)) return;
    const factor = dir === 'up' ? 1 + p / 100 : 1 - p / 100;
    let n = 0;
    for (const it of list) {
      const patch = {};
      if ((target === 'sale' || target === 'both') && (it.salePrice || 0) > 0) patch.salePrice = Math.max(0, Math.round(it.salePrice * factor));
      if ((target === 'wholesale' || target === 'both') && (it.wholesalePrice || 0) > 0) patch.wholesalePrice = Math.max(0, Math.round(it.wholesalePrice * factor));
      if (Object.keys(patch).length) { await db.items.update(it.id, patch); await queueSync('items', 'update', { id: it.id, ...patch }); n++; }
    }
    setDone(n);
  };

  return (
    <Modal title="💹 تعديل الأسعار بنسبة" onClose={onClose}>
      {done > 0 ? (
        <div className="empty">✅ تم تعديل أسعار {done} صنف.<div style={{ marginTop: 12 }}><button className="btn" onClick={onClose}>تمام</button></div></div>
      ) : (
        <>
          <p className="muted">هيتم التعديل على <b>{list.length}</b> صنف (حسب الفلتر الحالي في الصفحة). فلتر بالماركة أو النوع أولاً لو عايز تخصّص.</p>
          <div className="row">
            <div className="field"><label>النوع</label>
              <select className="input" value={dir} onChange={(e) => setDir(e.target.value)}>
                <option value="up">🔺 زيادة</option>
                <option value="down">🔻 خفض</option>
              </select></div>
            <div className="field"><label>النسبة %</label>
              <input className="input" type="number" min="0" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="مثال: 10" /></div>
          </div>
          <div className="field"><label>يطبّق على</label>
            <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="sale">سعر البيع</option>
              <option value="wholesale">سعر الجملة</option>
              <option value="both">البيع والجملة معاً</option>
            </select></div>
          <button className="btn block" onClick={apply} disabled={!Number(pct)}>تطبيق التعديل على {list.length} صنف</button>
        </>
      )}
    </Modal>
  );
}
