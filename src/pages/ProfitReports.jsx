import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { money, fmt, marginPct } from '../utils';
import { useAuth } from '../auth';

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

export default function ProfitReports() {
  const { activeBranch } = useAuth();
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());
  const [tab, setTab] = useState('item');
  const invoices = useLiveQuery(() => db.invoices.where('type').equals('sale').toArray(), [], []);

  const data = useMemo(() => {
    const inRange = (inv) => inv.status === 'active'
      && (inv.branchId || 1) === activeBranch
      && (!from || (inv.day || '') >= from) && (!to || (inv.day || '') <= to);
    const sales = invoices.filter(inRange);

    const byItem = new Map();
    const byCust = new Map();
    let revenue = 0, cost = 0;

    for (const inv of sales) {
      let invProfit = 0, invRev = 0;
      for (const l of (inv.lines || [])) {
        if (l.itemId == null) continue; // skip labor/service lines
        const q = (Number(l.qty) || 0);
        const rev = q * (Number(l.price) || 0);
        const cst = q * (Number(l.cost) || 0);
        revenue += rev; cost += cst; invRev += rev; invProfit += rev - cst;
        const row = byItem.get(l.itemId) || { name: l.name, qty: 0, rev: 0, cost: 0 };
        row.qty += q; row.rev += rev; row.cost += cst;
        byItem.set(l.itemId, row);
      }
      const key = inv.partyId || 'cash';
      const crow = byCust.get(key) || { name: inv.partyName || 'نقدي', count: 0, rev: 0, profit: 0 };
      crow.count += 1; crow.rev += invRev; crow.profit += invProfit;
      byCust.set(key, crow);
    }

    const items = [...byItem.values()].map((r) => ({ ...r, profit: r.rev - r.cost, margin: marginPct(r.cost, r.rev) }))
      .sort((a, b) => b.profit - a.profit);
    const custs = [...byCust.values()].sort((a, b) => b.profit - a.profit);
    return { items, custs, revenue, cost, profit: revenue - cost, count: sales.length };
  }, [invoices, from, to, activeBranch]);

  const exportCsv = () => {
    const rows = tab === 'item'
      ? [['الصنف', 'الكمية', 'المبيعات', 'التكلفة', 'الربح', 'الهامش %'],
         ...data.items.map((r) => [r.name, r.qty, Math.round(r.rev), Math.round(r.cost), Math.round(r.profit), r.margin])]
      : [['العميل', 'عدد الفواتير', 'المبيعات', 'الربح'],
         ...data.custs.map((r) => [r.name, r.count, Math.round(r.rev), Math.round(r.profit)])];
    const csv = rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ارباح-${tab}-${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <div className="page-head"><h1>📈 تقارير الأرباح</h1></div>

      <div className="list-tools" style={{ marginBottom: 10, alignItems: 'flex-end' }}>
        <div className="field" style={{ margin: 0 }}><label>من</label>
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="field" style={{ margin: 0 }}><label>إلى</label>
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <button className="btn ghost" onClick={exportCsv}>📊 تصدير CSV</button>
      </div>

      <div className="kpis">
        <div className="kpi"><div className="label">المبيعات</div><div className="value">{money(data.revenue)}</div><div className="sub">{fmt(data.count)} فاتورة</div></div>
        <div className="kpi"><div className="label">التكلفة</div><div className="value">{money(data.cost)}</div></div>
        <div className="kpi tone-green"><div className="label">صافي الربح</div><div className="value">{money(data.profit)}</div><div className="sub">هامش {fmt(marginPct(data.cost, data.revenue))}%</div></div>
      </div>

      <div className="tabs" style={{ display: 'flex', gap: 6, margin: '12px 0' }}>
        <button className={`btn ${tab === 'item' ? '' : 'ghost'}`} onClick={() => setTab('item')}>حسب الصنف</button>
        <button className={`btn ${tab === 'customer' ? '' : 'ghost'}`} onClick={() => setTab('customer')}>حسب العميل</button>
      </div>

      {tab === 'item' ? (
        data.items.length === 0 ? <div className="card empty"><p>لا توجد مبيعات في هذه الفترة</p></div> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>الصنف</th><th>الكمية</th><th>المبيعات</th><th>التكلفة</th><th>الربح</th><th>الهامش %</th></tr></thead>
              <tbody>
                {data.items.map((r, i) => (
                  <tr key={i}>
                    <td><b>{r.name}</b></td>
                    <td className="num">{fmt(r.qty)}</td>
                    <td className="num">{money(r.rev)}</td>
                    <td className="num muted">{money(r.cost)}</td>
                    <td className="num" style={{ color: r.profit >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{money(r.profit)}</td>
                    <td className="num" style={{ color: r.margin < 15 ? 'var(--red)' : 'var(--green)' }}>{r.rev > 0 ? r.margin + '%' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        data.custs.length === 0 ? <div className="card empty"><p>لا توجد مبيعات في هذه الفترة</p></div> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>العميل</th><th>عدد الفواتير</th><th>المبيعات</th><th>الربح</th></tr></thead>
              <tbody>
                {data.custs.map((r, i) => (
                  <tr key={i}>
                    <td><b>{r.name}</b></td>
                    <td className="num">{fmt(r.count)}</td>
                    <td className="num">{money(r.rev)}</td>
                    <td className="num" style={{ color: r.profit >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{money(r.profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
      <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
        الأرباح محسوبة من بنود فواتير البيع النشطة (سعر البيع − التكلفة وقت البيع)، وتتجاهل بنود الخدمة/المصنعية بدون صنف.
      </p>
    </>
  );
}
