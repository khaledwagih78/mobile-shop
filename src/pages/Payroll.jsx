import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, today, runPayslip } from '../db';
import { money, fmt } from '../utils';
import { Modal, Toast } from '../components/UI';
import { useAuth } from '../auth';

export default function Payroll() {
  const { user, activeBranch } = useAuth();
  const employees = useLiveQuery(() => db.employees.where('status').equals('active').toArray(), [], []);
  const payslips = useLiveQuery(() => db.payslips.orderBy('createdAt').reverse().toArray(), [], []);
  const [month, setMonth] = useState(today().slice(0, 7));
  const [cashRole, setCashRole] = useState('cash');
  const [pay, setPay] = useState(null); // payslip editor for one employee
  const [toast, setToast] = useState('');
  const notify = (m) => { setToast(m); setTimeout(() => setToast(''), 2800); };

  const paidThisMonth = useMemo(() => {
    const m = {};
    for (const p of payslips) if (p.month === month) m[p.employeeId] = p;
    return m;
  }, [payslips, month]);

  const monthPayslips = payslips.filter((p) => p.month === month);
  const monthTotal = monthPayslips.reduce((s, p) => s + (p.net || 0), 0);

  const openPay = (emp) => setPay({
    employeeId: emp.id, employeeName: emp.name, basic: String(emp.baseSalary || 0),
    allowances: '', overtime: '', commission: '', deductions: '', advances: '',
  });

  const net = pay ? (Number(pay.basic) || 0) + (Number(pay.allowances) || 0) + (Number(pay.overtime) || 0) + (Number(pay.commission) || 0) - (Number(pay.deductions) || 0) - (Number(pay.advances) || 0) : 0;

  const submit = async () => {
    await runPayslip({
      employeeId: pay.employeeId, employeeName: pay.employeeName, month,
      basic: Number(pay.basic) || 0, allowances: Number(pay.allowances) || 0, overtime: Number(pay.overtime) || 0,
      commission: Number(pay.commission) || 0, deductions: Number(pay.deductions) || 0, advances: Number(pay.advances) || 0,
      cashRole, branchId: activeBranch, userName: user.name,
    });
    notify(`✅ تم صرف راتب ${pay.employeeName}`);
    setPay(null);
  };

  return (
    <>
      <div className="page-head"><h1>💵 الرواتب</h1></div>

      <div className="list-tools">
        <span className="muted" style={{ alignSelf: 'center', fontSize: 13 }}>الشهر</span>
        <input className="input" style={{ maxWidth: 160 }} type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        <span className="muted" style={{ alignSelf: 'center', fontSize: 13 }}>الصرف من</span>
        <select className="input" style={{ maxWidth: 140 }} value={cashRole} onChange={(e) => setCashRole(e.target.value)}>
          <option value="cash">الصندوق</option>
          <option value="bank">البنك</option>
        </select>
        <span className="muted" style={{ alignSelf: 'center', fontSize: 13 }}>مصروف الشهر: <b style={{ color: 'var(--red)' }}>{money(monthTotal)}</b></span>
      </div>

      {employees.length === 0 ? (
        <div className="card empty"><div className="big-ico">💵</div><p>لا يوجد موظفون نشطون — أضِف موظفين من صفحة الموظفين</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>الموظف</th><th>الأساسي</th><th>الحالة</th><th>الصافي المصروف</th><th></th></tr></thead>
            <tbody>
              {employees.map((emp) => {
                const ps = paidThisMonth[emp.id];
                return (
                  <tr key={emp.id}>
                    <td><b>{emp.name}</b>{emp.jobTitle && <div className="meta muted">{emp.jobTitle}</div>}</td>
                    <td className="num">{money(emp.baseSalary || 0)}</td>
                    <td>{ps ? <span className="badge green">مصروف</span> : <span className="badge gray">لم يُصرف</span>}</td>
                    <td className="num">{ps ? money(ps.net) : '—'}</td>
                    <td>{!ps && <button className="btn accent sm" onClick={() => openPay(emp)}>مسير الراتب</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {monthPayslips.length > 0 && (
        <>
          <div className="page-head" style={{ marginTop: 20 }}><h2>مسيرات {month}</h2></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>الموظف</th><th>أساسي</th><th>بدلات</th><th>إضافي</th><th>عمولة</th><th>خصومات</th><th>سلف</th><th>الصافي</th></tr></thead>
              <tbody>
                {monthPayslips.map((p) => (
                  <tr key={p.id}>
                    <td>{p.employeeName}</td>
                    <td className="num">{fmt(p.basic)}</td>
                    <td className="num">{fmt(p.allowances)}</td>
                    <td className="num">{fmt(p.overtime)}</td>
                    <td className="num">{fmt(p.commission)}</td>
                    <td className="num" style={{ color: 'var(--red)' }}>{fmt(p.deductions)}</td>
                    <td className="num" style={{ color: 'var(--red)' }}>{fmt(p.advances)}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{money(p.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {pay && (
        <Modal title={`مسير راتب ${pay.employeeName} — ${month}`} onClose={() => setPay(null)}>
          <div className="row">
            <div className="field"><label>الراتب الأساسي</label>
              <input className="input" type="number" min="0" value={pay.basic} onChange={(e) => setPay({ ...pay, basic: e.target.value })} /></div>
            <div className="field"><label>بدلات</label>
              <input className="input" type="number" min="0" value={pay.allowances} onChange={(e) => setPay({ ...pay, allowances: e.target.value })} placeholder="0" /></div>
          </div>
          <div className="row">
            <div className="field"><label>إضافي / أوفرتايم</label>
              <input className="input" type="number" min="0" value={pay.overtime} onChange={(e) => setPay({ ...pay, overtime: e.target.value })} placeholder="0" /></div>
            <div className="field"><label>عمولة</label>
              <input className="input" type="number" min="0" value={pay.commission} onChange={(e) => setPay({ ...pay, commission: e.target.value })} placeholder="0" /></div>
          </div>
          <div className="row">
            <div className="field"><label>خصومات (غياب/جزاءات)</label>
              <input className="input" type="number" min="0" value={pay.deductions} onChange={(e) => setPay({ ...pay, deductions: e.target.value })} placeholder="0" /></div>
            <div className="field"><label>سلف مستقطعة</label>
              <input className="input" type="number" min="0" value={pay.advances} onChange={(e) => setPay({ ...pay, advances: e.target.value })} placeholder="0" /></div>
          </div>
          <div className="totals" style={{ margin: '10px 0' }}>
            <div className="trow grand"><span>صافي المستحق</span><span className="num">{money(net)}</span></div>
          </div>
          <button className="btn accent big block" onClick={submit} disabled={net <= 0}>💵 صرف الراتب</button>
        </Modal>
      )}

      <Toast msg={toast} />
    </>
  );
}
