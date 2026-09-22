import { useMemo, useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, recordProduction, stockOf } from '../db';
import { money, fmt, fmtDate, normAr } from '../utils';
import { useAuth } from '../auth';
import { Toast } from '../components/UI';

// A small searchable item picker used for both the finished product and each component.
function ItemPicker({ items, branch, onPick, placeholder }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const results = useMemo(() => {
    const t = normAr(q);
    if (!t) return [];
    return items.filter((it) => normAr(it.name).includes(t) || normAr(it.code).includes(t)).slice(0, 8);
  }, [q, items]);
  return (
    <div style={{ position: 'relative' }}>
      <input
        className="input" value={q} placeholder={placeholder}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {open && results.length > 0 && (
        <div className="search-drop">
          {results.map((it) => (
            <div key={it.id} className="search-item" onClick={() => { onPick(it); setQ(''); setOpen(false); }}>
              <div><b>{it.name}</b><div className="meta">{it.code}</div></div>
              <div style={{ textAlign: 'left' }}>
                <b className="num">{money(it.costPrice || 0)}</b>
                <div className="meta">رصيد: {fmt(stockOf(it, branch))}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Production() {
  const { user, activeBranch } = useAuth();
  const items = useLiveQuery(() => db.items.toArray(), [], []);
  const recent = useLiveQuery(
    () => db.productions.orderBy('createdAt').reverse().limit(20).toArray(),
    [], []
  );

  const [product, setProduct] = useState(null);
  const [qty, setQty] = useState('');
  const [comps, setComps] = useState([]); // { itemId, name, code, qty, costPrice }
  const [labor, setLabor] = useState('');
  const [other, setOther] = useState('');
  const [saveRecipe, setSaveRecipe] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  // when a product with a saved recipe (bom) is picked, prefill its components
  useEffect(() => {
    if (!product || !product.bom || product.bom.length === 0) return;
    const lines = product.bom.map((b) => {
      const it = items.find((x) => x.id === b.itemId);
      return it ? { itemId: it.id, name: it.name, code: it.code, qty: b.qty, costPrice: it.costPrice || 0 } : null;
    }).filter(Boolean);
    if (lines.length) { setComps(lines); setToast('📋 تم تحميل وصفة المنتج المحفوظة'); setTimeout(() => setToast(''), 2000); }
  }, [product]); // eslint-disable-line react-hooks/exhaustive-deps

  const addComp = (it) => {
    setComps((cs) => cs.find((c) => c.itemId === it.id)
      ? cs
      : [...cs, { itemId: it.id, name: it.name, code: it.code, qty: 1, costPrice: it.costPrice || 0 }]);
  };
  const setComp = (itemId, patch) => setComps((cs) => cs.map((c) => c.itemId === itemId ? { ...c, ...patch } : c));
  const removeComp = (itemId) => setComps((cs) => cs.filter((c) => c.itemId !== itemId));

  const materialsCost = comps.reduce((s, c) => s + Number(c.qty || 0) * Number(c.costPrice || 0), 0);
  const totalCost = materialsCost + Number(labor || 0) + Number(other || 0);
  const q = Number(qty || 0);
  const unitCost = q > 0 ? totalCost / q : 0;

  const canSave = product && q > 0 && comps.length > 0 && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await recordProduction({
        branchId: activeBranch, productId: product.id, productName: product.name, qty: q,
        components: comps, laborCost: Number(labor || 0), otherCost: Number(other || 0),
        saveRecipe, userId: user.id, userName: user.name,
      });
      setToast(`✅ تم تسجيل التصنيع ${res.number} — تكلفة الوحدة ${money(res.unitCost)}`);
      setProduct(null); setQty(''); setComps([]); setLabor(''); setOther(''); setSaveRecipe(false);
    } catch (e) {
      setToast('⚠️ ' + (e.message || 'تعذّر الحفظ'));
    } finally {
      setSaving(false);
      setTimeout(() => setToast(''), 3500);
    }
  };

  return (
    <>
      <div className="page-head"><h1>🏭 التصنيع</h1></div>

      <div className="card" style={{ maxWidth: 760 }}>
        <p className="muted" style={{ marginTop: 0 }}>
          حوّل <b>المواد الخام</b> لمنتج نهائي: اختر المنتج والكمية، أضف المواد المستهلكة وكمياتها،
          واكتب تكلفة العمالة والتشغيل. التطبيق هيخصم المواد الخام من المخزون، يضيف المنتج النهائي،
          ويحسب <b>تكلفة الوحدة</b> تلقائياً.
        </p>

        <div className="field">
          <label>المنتج النهائي</label>
          {product ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div className="input" style={{ flex: 1 }}><b>{product.name}</b> <span className="muted">({product.code})</span></div>
              <button className="btn ghost sm" onClick={() => { setProduct(null); setComps([]); }}>✕</button>
            </div>
          ) : (
            <ItemPicker items={items} branch={activeBranch} onPick={setProduct} placeholder="🔍 اختر المنتج اللي هيتصنّع..." />
          )}
        </div>

        <div className="field">
          <label>الكمية المنتَجة</label>
          <input className="input lg" type="number" min="0" step="any" value={qty}
            onChange={(e) => setQty(e.target.value)} placeholder="مثال: 100" />
        </div>

        <div className="field">
          <label>المواد الخام المستهلكة</label>
          <ItemPicker items={items} branch={activeBranch} onPick={addComp} placeholder="🔍 أضف مادة خام..." />
        </div>

        {comps.length > 0 && (
          <div className="table-wrap" style={{ marginTop: 6 }}>
            <table>
              <thead><tr><th>المادة</th><th>الكمية</th><th>تكلفة الوحدة</th><th>الإجمالي</th><th></th></tr></thead>
              <tbody>
                {comps.map((c) => (
                  <tr key={c.itemId}>
                    <td>{c.name}<div className="meta muted">{c.code}</div></td>
                    <td style={{ maxWidth: 90 }}>
                      <input className="input" type="number" min="0" step="any" value={c.qty}
                        onChange={(e) => setComp(c.itemId, { qty: Number(e.target.value) })} />
                    </td>
                    <td className="num muted">{money(c.costPrice)}</td>
                    <td className="num">{money(Number(c.qty || 0) * Number(c.costPrice || 0))}</td>
                    <td><button className="x" onClick={() => removeComp(c.itemId)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="row" style={{ marginTop: 8 }}>
          <div className="field"><label>👷 تكلفة العمالة</label>
            <input className="input" type="number" min="0" value={labor} onChange={(e) => setLabor(e.target.value)} placeholder="0" /></div>
          <div className="field"><label>⚙️ تكاليف تشغيل أخرى</label>
            <input className="input" type="number" min="0" value={other} onChange={(e) => setOther(e.target.value)} placeholder="0" /></div>
        </div>

        <div className="totals">
          <div className="trow"><span>تكلفة المواد</span><span className="num">{money(materialsCost)}</span></div>
          <div className="trow"><span>العمالة + التشغيل</span><span className="num">{money(Number(labor || 0) + Number(other || 0))}</span></div>
          <div className="trow grand"><span>إجمالي التكلفة</span><span className="num">{money(totalCost)}</span></div>
          {q > 0 && (
            <div className="trow" style={{ color: 'var(--green)' }}>
              <span>تكلفة الوحدة ({fmt(q)} وحدة)</span><span className="num">{money(unitCost)}</span>
            </div>
          )}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0', cursor: 'pointer' }}>
          <input type="checkbox" checked={saveRecipe} onChange={(e) => setSaveRecipe(e.target.checked)} />
          حفظ المكوّنات كوصفة للمنتج (تتحمّل تلقائياً في المرة الجاية)
        </label>

        <button className="btn accent big block" onClick={save} disabled={!canSave}>
          {saving ? '...جاري الحفظ' : '🏭 تسجيل التصنيع'}
        </button>
      </div>

      <div className="page-head" style={{ marginTop: 20 }}><h2>آخر عمليات التصنيع</h2></div>
      {recent.length === 0 ? (
        <div className="card empty"><div className="big-ico">🏭</div><p>لا توجد عمليات تصنيع بعد</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>رقم</th><th>المنتج</th><th>الكمية</th><th>إجمالي التكلفة</th><th>تكلفة الوحدة</th><th>التاريخ</th></tr></thead>
            <tbody>
              {recent.map((p) => (
                <tr key={p.id}>
                  <td className="num">{p.number}</td>
                  <td>{p.productName}</td>
                  <td className="num">{fmt(p.qty)}</td>
                  <td className="num">{money(p.totalCost)}</td>
                  <td className="num">{money(p.unitCost)}</td>
                  <td className="muted">{fmtDate(p.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Toast msg={toast} />
    </>
  );
}
