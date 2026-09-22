import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, today, adjustStock, writeOffStock, stockOf } from '../db';
import { money, fmt, normAr } from '../utils';
import { Toast } from '../components/UI';
import { useAuth } from '../auth';

export default function InventoryOps() {
  const { user, activeBranch, branches } = useAuth();
  const items = useLiveQuery(() => db.items.orderBy('name').toArray(), [], []);
  const branchName = branches.find((b) => b.id === activeBranch)?.name || 'الفرع';
  const [tab, setTab] = useState('count');
  const [q, setQ] = useState('');
  const [counts, setCounts] = useState({}); // itemId -> counted value (string)
  const [damageQty, setDamageQty] = useState({});
  const [toast, setToast] = useState('');
  const notify = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const filtered = useMemo(() => {
    const t = normAr(q);
    return (t ? items.filter((it) => normAr(it.name).includes(t) || normAr(it.code).includes(t)) : items).slice(0, 100);
  }, [q, items]);

  const t = today();
  const expiring = useMemo(() => {
    const soon = [];
    for (const it of items) {
      if (!it.expiry) continue;
      const days = Math.floor((new Date(it.expiry) - new Date(t)) / 86400000);
      if (days <= 60) soon.push({ it, days });
    }
    return soon.sort((a, b) => a.days - b.days);
  }, [items, t]);

  const doAdjust = async (it) => {
    const v = counts[it.id];
    if (v === undefined || v === '') return;
    const res = await adjustStock({ itemId: it.id, branchId: activeBranch, countedQty: Number(v), note: 'جرد', userName: user.name });
    setCounts((c) => ({ ...c, [it.id]: '' }));
    notify(res && res.diff !== 0 ? `✅ تم ضبط ${it.name} (فرق ${fmt(res.diff)})` : 'لا يوجد فرق');
  };

  const doDamage = async (it) => {
    const v = damageQty[it.id];
    if (!Number(v)) return;
    await writeOffStock({ itemId: it.id, branchId: activeBranch, qty: Number(v), reason: 'تالف', userName: user.name });
    setDamageQty((c) => ({ ...c, [it.id]: '' }));
    notify(`✅ تم تسجيل تالف ${it.name}`);
  };

  return (
    <>
      <div className="page-head"><h1>📋 الجرد والتسويات</h1></div>

      <div className="list-tools">
        <button className={`btn ${tab === 'count' ? '' : 'ghost'}`} onClick={() => setTab('count')}>🧮 جرد وتسوية</button>
        <button className={`btn ${tab === 'damage' ? '' : 'ghost'}`} onClick={() => setTab('damage')}>🗑️ تالف / هالك</button>
        <button className={`btn ${tab === 'expiry' ? '' : 'ghost'}`} onClick={() => setTab('expiry')}>📅 قرب الصلاحية{expiring.length ? ` (${expiring.length})` : ''}</button>
      </div>

      {(tab === 'count' || tab === 'damage') && (
        <input className="input" placeholder="🔍 بحث عن صنف..." value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 8 }} />
      )}

      {tab === 'count' && (
        <div className="table-wrap">
          <p className="muted" style={{ padding: '4px 10px', fontSize: 12 }}>اكتب الكمية الفعلية بعد الجرد في {branchName}، والفرق يتسجّل تلقائياً في المخزون والمحاسبة.</p>
          <table>
            <thead><tr><th>الصنف</th><th>الرصيد الدفتري</th><th>الكمية الفعلية</th><th>الفرق</th><th></th></tr></thead>
            <tbody>
              {filtered.map((it) => {
                const cur = stockOf(it, activeBranch);
                const counted = counts[it.id];
                const diff = counted === '' || counted === undefined ? null : Number(counted) - cur;
                return (
                  <tr key={it.id}>
                    <td>{it.name}<div className="meta muted">{it.code}</div></td>
                    <td className="num">{fmt(cur)}</td>
                    <td style={{ maxWidth: 110 }}><input className="input" type="number" value={counted ?? ''} placeholder={String(cur)} onChange={(e) => setCounts((c) => ({ ...c, [it.id]: e.target.value }))} /></td>
                    <td className="num" style={{ color: diff == null ? '' : diff === 0 ? 'var(--muted)' : diff > 0 ? 'var(--green)' : 'var(--red)' }}>{diff == null ? '—' : (diff > 0 ? '+' : '') + fmt(diff)}</td>
                    <td>{diff != null && diff !== 0 && <button className="btn accent sm" onClick={() => doAdjust(it)}>تسوية</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'damage' && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>الصنف</th><th>الرصيد</th><th>الكمية التالفة</th><th></th></tr></thead>
            <tbody>
              {filtered.map((it) => (
                <tr key={it.id}>
                  <td>{it.name}<div className="meta muted">{it.code}</div></td>
                  <td className="num">{fmt(stockOf(it, activeBranch))}</td>
                  <td style={{ maxWidth: 110 }}><input className="input" type="number" min="0" value={damageQty[it.id] ?? ''} onChange={(e) => setDamageQty((c) => ({ ...c, [it.id]: e.target.value }))} /></td>
                  <td>{Number(damageQty[it.id]) > 0 && <button className="btn danger sm" onClick={() => doDamage(it)}>تسجيل تالف</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'expiry' && (
        expiring.length === 0 ? (
          <div className="card empty"><div className="big-ico">📅</div><p>لا توجد أصناف قرب انتهاء الصلاحية (خلال 60 يوم)</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>الصنف</th><th>الرصيد</th><th>تاريخ الصلاحية</th><th>الحالة</th></tr></thead>
              <tbody>
                {expiring.map(({ it, days }) => (
                  <tr key={it.id}>
                    <td>{it.name}<div className="meta muted">{it.code}{it.batch ? ` · لوط ${it.batch}` : ''}</div></td>
                    <td className="num">{fmt(stockOf(it, activeBranch))}</td>
                    <td className="muted">{it.expiry}</td>
                    <td>{days < 0 ? <span className="badge red">منتهي منذ {fmt(-days)} يوم</span> : days <= 14 ? <span className="badge red">باقي {fmt(days)} يوم</span> : <span className="badge amber">باقي {fmt(days)} يوم</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      <Toast msg={toast} />
    </>
  );
}
