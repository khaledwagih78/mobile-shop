import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, today, computeDayCash, saveCashClose } from '../db';
import { money, fmtDate } from '../utils';
import { Toast } from '../components/UI';
import { useAuth } from '../auth';

export default function CashClose() {
  const { user, activeBranch } = useAuth();
  const [day, setDay] = useState(today());
  const [data, setData] = useState(null);
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [toast, setToast] = useState('');
  const notify = (m) => { setToast(m); setTimeout(() => setToast(''), 2800); };

  // reactive recompute: any invoice/payment/expense/close change re-runs it
  const tick = useLiveQuery(async () => {
    const [a, b, c, d] = await Promise.all([
      db.invoices.where('day').equals(day).count(),
      db.payments.where('day').equals(day).count(),
      db.expenses.where('day').equals(day).count(),
      db.cashCloses.where('day').equals(day).count(),
    ]);
    return a + b + c + d;
  }, [day], 0);

  useEffect(() => {
    let alive = true;
    computeDayCash(day, activeBranch).then((r) => { if (alive) setData(r); });
    return () => { alive = false; };
  }, [day, activeBranch, tick]);

  const history = useLiveQuery(
    () => db.cashCloses.orderBy('createdAt').reverse().filter((c) => (c.branchId || 1) === activeBranch).limit(15).toArray(),
    [activeBranch], []
  );

  const diff = data ? (Number(counted || 0) - data.expected) : 0;
  const doSave = async () => {
    if (!data) return;
    await saveCashClose({ day, branchId: activeBranch, opening: data.opening, counted: Number(counted) || 0, expected: data.expected, note, userName: user.name });
    notify('✅ تم حفظ تقفيل اليومية');
    setCounted(''); setNote('');
  };

  const Row = ({ label, value, sign, strong, color }) => (
    <div className="trow" style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontWeight: strong ? 800 : 400, color: color || '' }}>
      <span>{label}</span><span className="num">{sign || ''}{money(value)}</span>
    </div>
  );

  return (
    <>
      <div className="page-head"><h1>🧮 تقفيل اليومية / درج الكاش</h1></div>

      <div className="card" style={{ maxWidth: 560 }}>
        <div className="row">
          <div className="field"><label>اليوم</label>
            <input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></div>
        </div>

        {data && (
          <>
            <div style={{ borderTop: '1px solid var(--line,#eee)', marginTop: 8, paddingTop: 8 }}>
              <Row label="رصيد أول اليوم (من آخر تقفيل)" value={data.opening} />
              <div style={{ color: 'var(--green)' }}>
                <Row label="مبيعات نقدية" value={data.salesCash} sign="+ " />
                <Row label="تحصيل من العملاء" value={data.custPayIn} sign="+ " />
              </div>
              <div style={{ color: 'var(--red)' }}>
                <Row label="مشتريات مدفوعة نقداً" value={data.purchaseCash} sign="− " />
                <Row label="دفعات للموردين" value={data.supPayOut} sign="− " />
                <Row label="مصروفات" value={data.expensesOut} sign="− " />
                {data.saleReturnsCash > 0 && <Row label="مرتجعات بيع (مرتجع نقدي)" value={data.saleReturnsCash} sign="− " />}
              </div>
              <div style={{ borderTop: '2px solid var(--line,#ddd)', marginTop: 6 }}>
                <Row label="المفروض في الدرج (المتوقع)" value={data.expected} strong />
              </div>
            </div>

            <div className="field" style={{ marginTop: 12 }}>
              <label>الكاش الفعلي في الدرج (العدّ)</label>
              <input className="input lg" type="number" min="0" value={counted} onChange={(e) => setCounted(e.target.value)} placeholder="اعدّ الكاش واكتب الرقم" />
            </div>
            {counted !== '' && (
              <div className="card" style={{ padding: 10, background: Math.abs(diff) < 0.5 ? 'rgba(39,174,96,.08)' : 'rgba(231,76,60,.08)', border: 0 }}>
                <b style={{ color: Math.abs(diff) < 0.5 ? 'var(--green)' : 'var(--red)' }}>
                  {Math.abs(diff) < 0.5 ? '✅ مطابق — لا يوجد فرق' : diff > 0 ? `📈 زيادة: ${money(diff)}` : `📉 عجز: ${money(Math.abs(diff))}`}
                </b>
              </div>
            )}
            <div className="field"><label>ملاحظة (اختياري)</label>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="سبب الفرق أو أي ملاحظة" /></div>
            <button className="btn accent block" onClick={doSave} disabled={counted === ''}>💾 حفظ التقفيل</button>
          </>
        )}
      </div>

      <div className="section-title">سجل التقفيلات</div>
      {history.length === 0 ? (
        <div className="card empty"><div className="big-ico">🧮</div><p>لا توجد تقفيلات بعد</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>اليوم</th><th>متوقع</th><th>معدود</th><th>الفرق</th><th>بواسطة</th><th>وقت</th></tr></thead>
            <tbody>
              {history.map((c) => (
                <tr key={c.id}>
                  <td className="num">{c.day}</td>
                  <td className="num">{money(c.expected)}</td>
                  <td className="num">{money(c.counted)}</td>
                  <td className="num" style={{ color: Math.abs(c.difference) < 0.5 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                    {c.difference > 0 ? '+' : ''}{money(c.difference)}
                  </td>
                  <td className="muted">{c.userName || '—'}</td>
                  <td className="muted" style={{ fontSize: 11 }}>{fmtDate(c.createdAt)}</td>
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
