import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, today } from '../db';
import { money, fmt, fmtDate } from '../utils';

export default function Invoices() {
  const nav = useNavigate();
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [from, setFrom] = useState(today().slice(0, 7) + '-01');
  const [to, setTo] = useState(today());
  const [q, setQ] = useState('');

  const invoices = useLiveQuery(
    () => db.invoices.orderBy('createdAt').reverse().toArray(),
    [], []
  );

  const filtered = useMemo(() => {
    let list = invoices.filter((i) => i.day >= from && i.day <= to);
    if (typeFilter !== 'all') list = list.filter((i) => i.type === typeFilter);
    if (statusFilter !== 'all') list = list.filter((i) => i.status === statusFilter);
    const t = q.trim().toLowerCase();
    if (t) list = list.filter(
      (i) => (i.number || '').toLowerCase().includes(t) || (i.partyName || '').toLowerCase().includes(t)
    );
    return list;
  }, [invoices, typeFilter, statusFilter, from, to, q]);

  const activeSales = filtered.filter((i) => i.type === 'sale' && i.status === 'active');
  const activePurchases = filtered.filter((i) => i.type === 'purchase' && i.status === 'active');
  const totSales = activeSales.reduce((s, i) => s + i.total, 0);
  const totPurchases = activePurchases.reduce((s, i) => s + i.total, 0);
  const totProfit = activeSales.reduce((s, i) => s + (i.profit || 0), 0);

  return (
    <>
      <div className="page-head"><h1>🗂️ الفواتير</h1></div>

      <div className="kpis">
        <div className="kpi">
          <div className="label">إجمالي المبيعات</div>
          <div className="value">{money(totSales)}</div>
          <div className="sub">{activeSales.length} فاتورة</div>
        </div>
        <div className="kpi">
          <div className="label">إجمالي المشتريات</div>
          <div className="value">{money(totPurchases)}</div>
          <div className="sub">{activePurchases.length} فاتورة</div>
        </div>
        <div className="kpi tone-green">
          <div className="label">صافي الربح</div>
          <div className="value">{money(totProfit)}</div>
        </div>
      </div>

      <div className="list-tools">
        <input
          className="input"
          placeholder="بحث برقم الفاتورة أو اسم الطرف..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ maxWidth: 260 }}
        />
        <select className="input" style={{ maxWidth: 150 }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="all">كل الأنواع</option>
          <option value="sale">مبيعات</option>
          <option value="purchase">مشتريات</option>
        </select>
        <select className="input" style={{ maxWidth: 150 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">كل الحالات</option>
          <option value="active">فعّالة</option>
          <option value="cancelled">ملغاة</option>
        </select>
        <input className="input" style={{ maxWidth: 155 }} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input className="input" style={{ maxWidth: 155 }} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>

      {filtered.length === 0 ? (
        <div className="card empty">
          <div className="big-ico">🗂️</div>
          <p>لا توجد فواتير في هذه الفترة</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>رقم</th>
                <th>النوع</th>
                <th>الطرف</th>
                <th>الإجمالي</th>
                <th>الحالة</th>
                <th>بواسطة</th>
                <th>التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv) => (
                <tr key={inv.id} className="clickable" onClick={() => nav(`/invoices/${inv.id}`)}>
                  <td className="num">{inv.number}</td>
                  <td>
                    {inv.type === 'sale'
                      ? <span className="badge primary">بيع</span>
                      : <span className="badge gray">شراء</span>}
                  </td>
                  <td>{inv.partyName || 'نقدي'}</td>
                  <td className="num">{money(inv.total)}</td>
                  <td>
                    {inv.status === 'cancelled'
                      ? <span className="badge red">ملغاة</span>
                      : inv.remaining > 0
                        ? <span className="badge amber">آجل {money(inv.remaining)}</span>
                        : <span className="badge green">مدفوعة</span>}
                  </td>
                  <td className="muted">{inv.userName}</td>
                  <td className="muted">{fmtDate(inv.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ padding: '8px 14px' }}>
            إجمالي النتائج: {fmt(filtered.length)} فاتورة
          </p>
        </div>
      )}
    </>
  );
}
