import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, transferStock, stockOf } from '../db';
import { fmt } from '../utils';
import { useAuth } from '../auth';
import { Toast } from '../components/UI';

export default function Transfer() {
  const { user, branches, activeBranch } = useAuth();
  const items = useLiveQuery(() => db.items.toArray(), [], []);
  const [fromB, setFromB] = useState(activeBranch);
  const [toB, setToB] = useState(0);
  const [q, setQ] = useState('');
  const [lines, setLines] = useState([]); // {itemId, name, qty, avail}
  const [toast, setToast] = useState('');
  const [saving, setSaving] = useState(false);

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return items
      .filter((it) => (it.name || '').toLowerCase().includes(t) || (it.code || '').toLowerCase().includes(t) || (it.barcode || '') === t)
      .slice(0, 8);
  }, [q, items]);

  const addLine = (it) => {
    if (lines.find((l) => l.itemId === it.id)) { setQ(''); return; }
    setLines((ls) => [...ls, { itemId: it.id, name: it.name, qty: 1 }]);
    setQ('');
  };
  const setQty = (id, v) => setLines((ls) => ls.map((l) => l.itemId === id ? { ...l, qty: Math.max(1, Number(v) || 1) } : l));
  const removeLine = (id) => setLines((ls) => ls.filter((l) => l.itemId !== id));

  const availAt = (itemId, branchId) => {
    const it = items.find((x) => x.id === itemId);
    return it ? stockOf(it, branchId) : 0;
  };

  const doTransfer = async () => {
    if (!toB || toB === fromB) return setToast('اختر فرعين مختلفين');
    if (!lines.length) return setToast('أضف صنف واحد على الأقل');
    setSaving(true);
    try {
      const res = await transferStock({ fromBranch: Number(fromB), toBranch: Number(toB), lines, userName: user.name });
      setToast(`✅ تم تحويل ${res.count} صنف`);
      setLines([]);
    } catch (e) {
      setToast('خطأ: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const bname = (id) => branches.find((b) => b.id === Number(id))?.name || '';

  return (
    <>
      <div className="page-head"><h1>🔄 تحويل بضاعة بين الفروع</h1></div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div className="row">
          <div className="field"><label>من فرع</label>
            <select className="input" value={fromB} onChange={(e) => setFromB(Number(e.target.value))}>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="field"><label>إلى فرع</label>
            <select className="input" value={toB} onChange={(e) => setToB(Number(e.target.value))}>
              <option value={0}>اختر الفرع...</option>
              {branches.filter((b) => b.id !== Number(fromB)).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        </div>

        <div className="field" style={{ position: 'relative' }}>
          <label>إضافة صنف</label>
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 ابحث بالاسم أو الكود..." />
          {results.length > 0 && (
            <div className="search-results">
              {results.map((it) => (
                <div key={it.id} className="search-row" onClick={() => addLine(it)}>
                  <span>{it.name} <small className="muted">{it.code}</small></span>
                  <span className="muted">متاح: {fmt(stockOf(it, Number(fromB)))}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {lines.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>الصنف</th><th>المتاح ({bname(fromB)})</th><th>الكمية المحوّلة</th><th></th></tr></thead>
            <tbody>
              {lines.map((l) => {
                const avail = availAt(l.itemId, Number(fromB));
                const over = l.qty > avail;
                return (
                  <tr key={l.itemId}>
                    <td><b>{l.name}</b></td>
                    <td className="num">{fmt(avail)}</td>
                    <td>
                      <input className="input" type="number" min="1" style={{ width: 90 }} value={l.qty}
                        onChange={(e) => setQty(l.itemId, e.target.value)} />
                      {over && <div style={{ color: 'var(--red)', fontSize: 11 }}>أكبر من المتاح</div>}
                    </td>
                    <td><button className="btn ghost sm" onClick={() => removeLine(l.itemId)}>✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <button className="btn big block" style={{ marginTop: 16 }} onClick={doTransfer}
        disabled={saving || !lines.length || !toB || Number(toB) === Number(fromB)}>
        {saving ? '...' : `🔄 تحويل ${lines.length ? `(${lines.length} صنف)` : ''} ${toB ? `إلى ${bname(toB)}` : ''}`}
      </button>

      <Toast msg={toast} />
    </>
  );
}
