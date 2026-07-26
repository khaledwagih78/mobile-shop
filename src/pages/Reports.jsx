import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, today } from '../db';
import { money, fmt, fmtDate, monthOf } from '../utils';

const TABS = [
  { id: 'daily', label: 'مبيعات يومية' },
  { id: 'monthly', label: 'مبيعات شهرية' },
  { id: 'byItem', label: 'أرباح الأصناف' },
  { id: 'byCustomer', label: 'أرباح العملاء' },
  { id: 'top', label: 'الأكثر مبيعاً' },
  { id: 'moves', label: 'حركة المخزون' },
  { id: 'debts', label: 'الديون والآجل' },
];

export default function Reports() {
  const [tab, setTab] = useState('daily');
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [month, setMonth] = useState(monthOf(today()));

  const invoices = useLiveQuery(() => db.invoices.toArray(), [], []);
  const expenses = useLiveQuery(() => db.expenses.toArray(), [], []);
  const moves = useLiveQuery(() => db.stockMoves.orderBy('createdAt').reverse().limit(300).toArray(), [], []);
  const customers = useLiveQuery(() => db.customers.toArray(), [], []);

  const range = tab === 'monthly'
    ? { from: month + '-01', to: month + '-31' }
    : { from, to };

  const sales = useMemo(
    () => invoices.filter((i) => i.type === 'sale' && i.status === 'active' && i.day >= range.from && i.day <= range.to),
    [invoices, range.from, range.to]
  );
  const exp = useMemo(
    () => expenses.filter((e) => e.day >= range.from && e.day <= range.to),
    [expenses, range.from, range.to]
  );

  const totSales = sales.reduce((s, i) => s + i.total, 0);
  const totCost = sales.reduce((s, i) => s + i.lines.reduce((x, l) => x + l.qty * l.cost, 0), 0);
  const totProfit = sales.reduce((s, i) => s + (i.profit || 0), 0);
  const totExp = exp.reduce((s, e) => s + e.amount, 0);

  // aggregate by item
  const byItem = useMemo(() => {
    const m = new Map();
    for (const inv of sales) for (const l of inv.lines) {
      const cur = m.get(l.itemId) || { name: l.name, code: l.code, qty: 0, sales: 0, cost: 0 };
      cur.qty += l.qty; cur.sales += l.qty * l.price; cur.cost += l.qty * l.cost;
      m.set(l.itemId, cur);
    }
    return [...m.values()].map((r) => ({ ...r, profit: r.sales - r.cost }));
  }, [sales]);

  const byCustomer = useMemo(() => {
    const m = new Map();
    for (const inv of sales) {
      const key = inv.partyName || 'نقدي';
      const cur = m.get(key) || { name: key, count: 0, sales: 0, profit: 0 };
      cur.count++; cur.sales += inv.total; cur.profit += inv.profit || 0;
      m.set(key, cur);
    }
    return [...m.values()].sort((a, b) => b.sales - a.sales);
  }, [sales]);

  const debtors = customers.filter((c) => (c.balance || 0) > 0).sort((a, b) => b.balance - a.balance);

  const kpiBlock = (
    <div className="kpis">
      <div className="kpi"><div className="label">إجمالي المبيعات</div><div className="value">{money(totSales)}</div><div className="sub">{sales.length} فاتورة</div></div>
      <div className="kpi"><div className="label">إجمالي التكلفة</div><div className="value">{money(totCost)}</div></div>
      <div className="kpi tone-green"><div className="label">صافي الربح</div><div className="value">{money(totProfit)}</div><div className="sub">نسبة الربح {totCost > 0 ? Math.round((totProfit / totCost) * 100) : 0}% على التكلفة</div></div>
      <div className="kpi tone-red"><div className="label">المصروفات</div><div className="value">{money(totExp)}</div></div>
      <div className="kpi tone-accent"><div className="label">الربح النهائي</div><div className="value">{money(totProfit - totExp)}</div></div>
    </div>
  );

  return (
    <>
      <div className="page-head"><h1>📈 التقارير</h1></div>

      <div className="list-tools">
        <select className="input" style={{ maxWidth: 200 }} value={tab} onChange={(e) => setTab(e.target.value)}>
          {TABS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        {tab === 'monthly' ? (
          <input className="input" style={{ maxWidth: 170 }} type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        ) : tab !== 'moves' && tab !== 'debts' ? (
          <>
            <input className="input" style={{ maxWidth: 170 }} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input className="input" style={{ maxWidth: 170 }} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </>
        ) : null}
      </div>

      {(tab === 'daily' || tab === 'monthly') && (
        <>
          {kpiBlock}
          <div className="table-wrap">
            <table>
              <thead><tr><th>رقم</th><th>العميل</th><th>الإجمالي</th><th>الربح</th><th>التاريخ</th></tr></thead>
              <tbody>
                {sales.map((i) => (
                  <tr key={i.id}>
                    <td className="num">{i.number}</td><td>{i.partyName || 'نقدي'}</td>
                    <td className="num">{money(i.total)}</td>
                    <td className="num" style={{ color: 'var(--green)' }}>{money(i.profit)}</td>
                    <td className="muted">{fmtDate(i.createdAt)}</td>
                  </tr>
                ))}
                {sales.length === 0 && <tr><td colSpan="5" className="empty">لا توجد مبيعات في هذه الفترة</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'byItem' && (
        <ReportTable
          head={['الصنف', 'الكمية', 'المبيعات', 'التكلفة', 'الربح', 'ربح %']}
          rows={byItem.sort((a, b) => b.profit - a.profit).map((r) => [r.name, fmt(r.qty), money(r.sales), money(r.cost), money(r.profit), (r.cost > 0 ? Math.round((r.profit / r.cost) * 100) : 0) + '%'])}
        />
      )}

      {tab === 'byCustomer' && (
        <ReportTable
          head={['العميل', 'عدد الفواتير', 'المبيعات', 'الربح']}
          rows={byCustomer.map((r) => [r.name, fmt(r.count), money(r.sales), money(r.profit)])}
        />
      )}

      {tab === 'top' && (
        <ReportTable
          head={['#', 'الصنف', 'الكمية المباعة', 'المبيعات']}
          rows={byItem.sort((a, b) => b.qty - a.qty).slice(0, 20).map((r, i) => [i + 1, r.name, fmt(r.qty), money(r.sales)])}
        />
      )}

      {tab === 'moves' && (
        <ReportTable
          head={['الصنف', 'الحركة', 'الكمية', 'المرجع', 'التاريخ']}
          rows={moves.map((m) => [m.itemName, m.direction === 'in' ? 'دخل ⬇' : 'خرج ⬆', fmt(m.qty), m.refNumber, fmtDate(m.createdAt)])}
        />
      )}

      {tab === 'debts' && (
        <>
          <div className="kpis">
            <div className="kpi tone-red">
              <div className="label">إجمالي الديون الآجلة</div>
              <div className="value">{money(debtors.reduce((s, c) => s + c.balance, 0))}</div>
              <div className="sub">{debtors.length} عميل</div>
            </div>
          </div>
          <ReportTable
            head={['العميل', 'الهاتف', 'المديونية']}
            rows={debtors.map((c) => [c.name, c.phone || '—', money(c.balance)])}
          />
        </>
      )}
    </>
  );
}

function ReportTable({ head, rows }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={head.length} className="empty">لا توجد بيانات</td></tr>
          ) : rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} className={j > 0 ? 'num' : ''}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
