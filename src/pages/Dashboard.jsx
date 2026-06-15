import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, today, getSetting } from '../db';
import { money, fmt, fmtDate, can } from '../utils';
import { useAuth } from '../auth';

export default function Dashboard() {
  const nav = useNavigate();
  const { user } = useAuth();
  const day = today();

  const todaySales = useLiveQuery(
    () => db.invoices.where('day').equals(day).and((i) => i.type === 'sale' && i.status === 'active').toArray(),
    [day], []
  );
  const customersCount = useLiveQuery(() => db.customers.count(), [], 0);
  const items = useLiveQuery(() => db.items.toArray(), [], []);
  const recent = useLiveQuery(
    () => db.invoices.orderBy('createdAt').reverse().limit(8).toArray(),
    [], []
  );
  const todayExpenses = useLiveQuery(() => db.expenses.where('day').equals(day).toArray(), [day], []);
  const debts = useLiveQuery(() => db.customers.filter((c) => (c.balance || 0) > 0).toArray(), [], []);
  const usdRate = useLiveQuery(() => getSetting('usdRate', 0), [], 0);

  const salesTotal = todaySales.reduce((s, i) => s + i.total, 0);
  const profitTotal = todaySales.reduce((s, i) => s + (i.profit || 0), 0);
  const expTotal = todayExpenses.reduce((s, e) => s + e.amount, 0);
  const stockValue = items.reduce((s, it) => s + (it.stock || 0) * (it.costPrice || 0), 0);
  const lowStock = items.filter((it) => (it.stock || 0) <= (it.minStock || 0));
  const debtsTotal = debts.reduce((s, c) => s + c.balance, 0);

  return (
    <>
      <div className="page-head">
        <h1>الرئيسية</h1>
        {can(user.role, 'pos') && (
          <button className="btn accent big" onClick={() => nav('/pos')}>＋ بيع جديد</button>
        )}
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="label">مبيعات اليوم</div>
          <div className="value">{money(salesTotal)}</div>
          <div className="sub">{todaySales.length} فاتورة</div>
        </div>
        <div className="kpi tone-green">
          <div className="label">أرباح اليوم</div>
          <div className="value">{money(profitTotal - expTotal)}</div>
          <div className="sub">بعد خصم مصروفات {money(expTotal)}</div>
        </div>
        <div className="kpi">
          <div className="label">العملاء</div>
          <div className="value">{fmt(customersCount)}</div>
          <div className="sub">ديون آجلة: {money(debtsTotal)}</div>
        </div>
        <div className="kpi">
          <div className="label">قيمة المخزون</div>
          <div className="value">{money(stockValue)}</div>
          <div className="sub">{items.length} صنف</div>
        </div>
        {Number(usdRate) > 0 && (
          <div className="kpi tone-accent">
            <div className="label">💵 سعر الدولار</div>
            <div className="value">{fmt(usdRate)}</div>
            <div className="sub">يُعدّل من الإعدادات</div>
          </div>
        )}
      </div>

      {lowStock.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--amber)', marginBottom: 16 }}>
          <b style={{ color: 'var(--amber)' }}>⚠️ أصناف قاربت على النفاد ({lowStock.length})</b>
          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {lowStock.slice(0, 10).map((it) => (
              <Link key={it.id} to="/items" className="badge amber">
                {it.name} — متبقي {fmt(it.stock)}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="section-title">آخر الفواتير</div>
      {recent.length === 0 ? (
        <div className="card empty">
          <div className="big-ico">🧾</div>
          <p>لا توجد فواتير بعد. ابدأ بأول عملية بيع!</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>رقم</th><th>النوع</th><th>الطرف</th><th>الإجمالي</th><th>الحالة</th><th>التاريخ</th></tr>
            </thead>
            <tbody>
              {recent.map((inv) => (
                <tr key={inv.id} className="clickable" onClick={() => nav(`/invoices/${inv.id}`)}>
                  <td className="num">{inv.number}</td>
                  <td>{inv.type === 'sale' ? <span className="badge primary">بيع</span> : <span className="badge gray">شراء</span>}</td>
                  <td>{inv.partyName || 'نقدي'}</td>
                  <td className="num">{money(inv.total)}</td>
                  <td>{inv.status === 'cancelled' ? <span className="badge red">ملغاة</span> : inv.remaining > 0 ? <span className="badge amber">آجل {money(inv.remaining)}</span> : <span className="badge green">مدفوعة</span>}</td>
                  <td className="muted">{fmtDate(inv.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
