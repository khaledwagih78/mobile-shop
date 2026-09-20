import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db, stockOf } from '../db';
import { money, fmt } from '../utils';
import { useAuth } from '../auth';

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

export default function SmartAnalytics() {
  const { activeBranch } = useAuth();
  const nav = useNavigate();
  const invoices = useLiveQuery(() => db.invoices.where('type').equals('sale').toArray(), [], []);
  const items = useLiveQuery(() => db.items.toArray(), [], []);
  const expenses = useLiveQuery(() => db.expenses.toArray(), [], []);

  const A = useMemo(() => {
    const inBranch = (r) => (r.branchId || 1) === activeBranch;
    const active = invoices.filter((i) => i.status === 'active' && inBranch(i));
    const c30 = daysAgo(30), c60 = daysAgo(60), c15 = daysAgo(15);

    // per-item base-qty sold in last 30 / last 60 days
    const qty30 = {}, qty60 = {};
    for (const inv of active) {
      const recent30 = inv.day >= c30, recent60 = inv.day >= c60;
      if (!recent60) continue;
      for (const l of (inv.lines || [])) {
        if (l.itemId == null) continue;
        const base = (Number(l.qty) || 0) * (Number(l.factor) || 1);
        if (recent30) qty30[l.itemId] = (qty30[l.itemId] || 0) + base;
        qty60[l.itemId] = (qty60[l.itemId] || 0) + base;
      }
    }

    // reorder suggestions
    const reorder = [];
    for (const it of items) {
      const sold = qty30[it.id] || 0;
      const velocity = sold / 30;
      const stock = stockOf(it, activeBranch);
      const daysLeft = velocity > 0 ? stock / velocity : Infinity;
      const low = stock <= (it.minStock || 0);
      if (low || daysLeft < 14) {
        const suggest = Math.max(0, Math.ceil(velocity * 30) - stock, low ? (it.minStock || 0) - stock : 0);
        if (suggest > 0 || low) reorder.push({ it, stock, velocity, daysLeft, suggest: Math.max(suggest, 1) });
      }
    }
    reorder.sort((a, b) => a.daysLeft - b.daysLeft);

    // top sellers & stagnant
    const top = Object.entries(qty30).map(([id, q]) => ({ it: items.find((x) => x.id === Number(id)), q }))
      .filter((r) => r.it).sort((a, b) => b.q - a.q).slice(0, 5);
    const stagnant = items.filter((it) => stockOf(it, activeBranch) > 0 && !(qty60[it.id] > 0)).slice(0, 20);

    // sales forecast (last 30 vs prev 30) and recent trend (15 vs prev 15)
    const sales30 = active.filter((i) => i.day >= c30).reduce((s, i) => s + i.total, 0);
    const salesPrev30 = active.filter((i) => i.day < c30 && i.day >= c60).reduce((s, i) => s + i.total, 0);
    const s15 = active.filter((i) => i.day >= c15).reduce((s, i) => s + i.total, 0);
    const sPrev15 = active.filter((i) => i.day < c15 && i.day >= c30).reduce((s, i) => s + i.total, 0);
    const trendPct = sPrev15 > 0 ? Math.round(((s15 - sPrev15) / sPrev15) * 100) : 0;
    const forecast = Math.round(sales30 * (1 + trendPct / 100));

    // expense anomaly (this month vs avg of prior 3 months)
    const monthKey = (d) => (d || '').slice(0, 7);
    const now = new Date();
    const curM = now.toISOString().slice(0, 7);
    const expBranch = expenses.filter((e) => (e.branchId || 1) === activeBranch);
    const byMonth = {};
    for (const e of expBranch) byMonth[monthKey(e.day)] = (byMonth[monthKey(e.day)] || 0) + (e.amount || 0);
    const prev3 = [1, 2, 3].map((k) => { const d = new Date(now.getFullYear(), now.getMonth() - k, 1); return d.toISOString().slice(0, 7); });
    const prevVals = prev3.map((m) => byMonth[m] || 0);
    const avgPrev = prevVals.reduce((s, v) => s + v, 0) / (prevVals.filter((v) => v > 0).length || 1);
    const curExp = byMonth[curM] || 0;
    const expAnomaly = avgPrev > 0 && curExp > avgPrev * 1.3 ? { curExp, avgPrev, pct: Math.round(((curExp - avgPrev) / avgPrev) * 100) } : null;

    return { reorder, top, stagnant, sales30, salesPrev30, trendPct, forecast, expAnomaly };
  }, [invoices, items, expenses, activeBranch]);

  return (
    <>
      <div className="page-head"><h1>🧠 التحليلات الذكية</h1></div>

      <div className="kpis">
        <div className="kpi"><div className="label">مبيعات آخر 30 يوم</div><div className="value">{money(A.sales30)}</div></div>
        <div className="kpi" style={{ borderColor: A.trendPct >= 0 ? 'var(--green)' : 'var(--red)' }}>
          <div className="label">الاتجاه (آخر 15 مقابل السابقة)</div>
          <div className="value" style={{ color: A.trendPct >= 0 ? 'var(--green)' : 'var(--red)' }}>{A.trendPct >= 0 ? '▲' : '▼'} {fmt(Math.abs(A.trendPct))}%</div>
        </div>
        <div className="kpi tone-accent"><div className="label">توقع مبيعات الشهر القادم</div><div className="value">{money(A.forecast)}</div><div className="sub">تقدير مبني على بياناتك</div></div>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: -6 }}>⚠️ التوقعات تقديرية مبنية على مبيعاتك السابقة، وليست أرقاماً مؤكدة.</p>

      {A.expAnomaly && (
        <div className="card" style={{ borderColor: 'var(--red)', margin: '12px 0' }}>
          <b style={{ color: 'var(--red)' }}>🚨 مصروفات غير معتادة هذا الشهر</b>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            مصروفات الشهر ({money(A.expAnomaly.curExp)}) أعلى بنسبة {fmt(A.expAnomaly.pct)}% من متوسط آخر 3 شهور ({money(A.expAnomaly.avgPrev)}).
          </p>
        </div>
      )}

      <div className="section-title">🔄 مقترحات إعادة الطلب</div>
      {A.reorder.length === 0 ? (
        <div className="card empty"><p>لا توجد أصناف تحتاج إعادة طلب حالياً 👍</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>الصنف</th><th>الرصيد</th><th>معدل البيع/يوم</th><th>يكفي لـ</th><th>الكمية المقترحة</th></tr></thead>
            <tbody>
              {A.reorder.slice(0, 20).map(({ it, stock, velocity, daysLeft, suggest }) => (
                <tr key={it.id} className="clickable" onClick={() => nav('/items')}>
                  <td><b>{it.name}</b><div className="meta muted">{it.code}</div></td>
                  <td className="num">{fmt(stock)}</td>
                  <td className="num muted">{velocity > 0 ? velocity.toFixed(1) : '—'}</td>
                  <td className="num">{daysLeft === Infinity ? '—' : <span style={{ color: daysLeft < 7 ? 'var(--red)' : 'var(--amber)' }}>{fmt(Math.round(daysLeft))} يوم</span>}</td>
                  <td className="num" style={{ fontWeight: 700, color: 'var(--accent, #0F4C5C)' }}>{fmt(suggest)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid-2" style={{ marginTop: 14 }}>
        <div>
          <div className="section-title">🏆 الأكثر مبيعاً (30 يوم)</div>
          {A.top.length === 0 ? <div className="card empty"><p>لا توجد مبيعات</p></div> : (
            <div className="card">
              {A.top.map((r, i) => (
                <div key={r.it.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
                  <span>{i + 1}. {r.it.name}</span><b className="num">{fmt(r.q)}</b>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <div className="section-title">💤 أصناف راكدة (بدون مبيعات 60 يوم)</div>
          {A.stagnant.length === 0 ? <div className="card empty"><p>لا توجد أصناف راكدة 👍</p></div> : (
            <div className="card">
              {A.stagnant.slice(0, 10).map((it) => (
                <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
                  <span>{it.name}</span><b className="num muted">رصيد {fmt(stockOf(it, activeBranch))}</b>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
