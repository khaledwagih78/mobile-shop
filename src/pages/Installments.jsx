import { useMemo, useState, Fragment } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, today, getSetting, createInstallmentPlan, payInstallment } from '../db';
import { money, fmt, fmtDay } from '../utils';
import { exportOverdueCustomers, printOverdueCustomers } from '../overdueExport';
import { Modal, Toast } from '../components/UI';
import { useAuth } from '../auth';

export default function Installments() {
  const { user, activeBranch } = useAuth();
  const customers = useLiveQuery(() => db.customers.toArray(), [], []);
  const plans = useLiveQuery(() => db.installmentPlans.orderBy('createdAt').reverse().toArray(), [], []);
  const invoices = useLiveQuery(() => db.invoices.where('type').equals('sale').toArray(), [], []);
  const payments = useLiveQuery(() => db.payments.toArray(), [], []);
  const creditDays = useLiveQuery(() => getSetting('creditDays', 30), [], 30);
  const bizName = useLiveQuery(() => getSetting('bizName', 'النشاط'), [], 'النشاط');

  const [tab, setTab] = useState('plans');
  const [minDays, setMinDays] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [toast, setToast] = useState('');
  const [form, setForm] = useState(null);
  const [payFor, setPayFor] = useState(null); // { plan, inst }
  const [expanded, setExpanded] = useState(null);

  const t = today();
  const notify = (m) => { setToast(m); setTimeout(() => setToast(''), 2800); };

  const openNew = () => setForm({ customerId: '', total: '', downPayment: '', count: '6', startDate: t });

  const savePlan = async () => {
    const cust = customers.find((c) => c.id === Number(form.customerId));
    if (!cust) return;
    await createInstallmentPlan({
      customerId: cust.id, customerName: cust.name,
      total: Number(form.total) || 0, downPayment: Number(form.downPayment) || 0,
      count: Number(form.count) || 1, startDate: form.startDate, branchId: activeBranch, userName: user.name,
    });
    notify('✅ تم إنشاء خطة التقسيط');
    setForm(null);
  };

  const doPay = async (amount) => {
    await payInstallment({ planId: payFor.plan.id, no: payFor.inst.no, amount: Number(amount), userName: user.name });
    notify('✅ تم تحصيل القسط');
    setPayFor(null);
  };

  const instStatus = (inst) => {
    if (inst.status === 'paid') return { label: 'مدفوع', cls: 'green' };
    const overdue = inst.dueDate < t;
    if (inst.status === 'partial') return { label: overdue ? 'متأخر (جزئي)' : 'جزئي', cls: overdue ? 'red' : 'amber' };
    return overdue ? { label: 'متأخر', cls: 'red' } : { label: 'مستحق', cls: 'gray' };
  };

  const planSummary = (p) => {
    const paid = p.installments.reduce((s, i) => s + (i.paidAmount || 0), 0);
    const paidCount = p.installments.filter((i) => i.status === 'paid').length;
    const overdue = p.installments.filter((i) => i.status !== 'paid' && i.dueDate < t).length;
    const next = p.installments.find((i) => i.status !== 'paid');
    return { paid, remaining: Math.round((p.financed - paid) * 100) / 100, paidCount, overdue, next };
  };

  // effective due date of a sale invoice: explicit dueDate, else day + creditDays
  const dueOf = (inv) => {
    if (inv.dueDate) return inv.dueDate;
    if (!inv.day) return t;
    return new Date(new Date(inv.day).getTime() + (Number(creditDays) || 0) * 86400000).toISOString().slice(0, 10);
  };

  // ---- aging (FIFO allocation of payments to oldest invoices, bucketed by days past DUE date) ----
  const aging = useMemo(() => {
    const salesByCust = {};
    for (const inv of invoices) {
      if (inv.status !== 'active' || !(inv.remaining > 0) || !inv.partyId) continue;
      (salesByCust[inv.partyId] ||= []).push(inv);
    }
    const payByCust = {};
    for (const p of payments) if (p.partyType === 'customer') payByCust[p.partyId] = (payByCust[p.partyId] || 0) + (p.amount || 0);
    const rows = [];
    for (const c of customers) {
      const bal = c.balance || 0;
      if (bal <= 0) continue;
      // allocate payments FIFO to oldest invoices (by due date)
      const invs = (salesByCust[c.id] || []).slice().sort((a, b) => dueOf(a).localeCompare(dueOf(b)));
      let pay = payByCust[c.id] || 0;
      const b = { b0: 0, b30: 0, b60: 0, b90: 0 };
      let oldestDue = null, overdueInvoices = 0, overdueAmount = 0, maxOverdueDays = 0;
      for (const inv of invs) {
        let rem = inv.remaining || 0;
        const applied = Math.min(pay, rem); pay -= applied; rem -= applied;
        if (rem <= 0.001) continue;
        const due = dueOf(inv);
        const overdueDays = Math.floor((new Date(t) - new Date(due)) / 86400000);
        // bucket by days past due (not-yet-due amounts fall in the current 0–30 bucket)
        if (overdueDays <= 30) b.b0 += rem; else if (overdueDays <= 60) b.b30 += rem; else if (overdueDays <= 90) b.b60 += rem; else b.b90 += rem;
        if (overdueDays > 0) {
          overdueInvoices += 1; overdueAmount += rem;
          if (overdueDays > maxOverdueDays) maxOverdueDays = overdueDays;
          if (!oldestDue || due < oldestDue) oldestDue = due;
        }
      }
      let total = b.b0 + b.b30 + b.b60 + b.b90;
      if (total <= 0.001) { b.b0 = bal; total = bal; } // opening/untracked balance → current bucket
      rows.push({ c, ...b, total, oldestDue, overdueInvoices, overdueAmount, maxOverdueDays });
    }
    return rows.sort((a, b) => b.total - a.total);
  }, [customers, invoices, payments, t, creditDays]);

  const agingTotals = aging.reduce((s, r) => ({ b0: s.b0 + r.b0, b30: s.b30 + r.b30, b60: s.b60 + r.b60, b90: s.b90 + r.b90, total: s.total + r.total }), { b0: 0, b30: 0, b60: 0, b90: 0, total: 0 });

  // ---- overdue filter (min days late + min outstanding amount) ----
  const overdue = useMemo(() => {
    const md = Number(minDays) || 0, ma = Number(minAmount) || 0;
    return aging
      .filter((r) => r.maxOverdueDays >= (md || 1) && r.overdueAmount >= ma && r.overdueAmount > 0)
      .sort((a, b) => b.maxOverdueDays - a.maxOverdueDays || b.overdueAmount - a.overdueAmount);
  }, [aging, minDays, minAmount]);

  const overdueRows = overdue.map((r) => ({
    name: r.c.name, phone: r.c.phone || '', oldestDue: r.oldestDue || '',
    overdueDays: r.maxOverdueDays, overdueInvoices: r.overdueInvoices,
    overdueAmount: r.overdueAmount, balance: r.total,
  }));

  const activePlans = plans.filter((p) => p.status === 'active');

  return (
    <>
      <div className="page-head">
        <h1>💳 الأقساط والديون</h1>
        {tab === 'plans' && <button className="btn accent" onClick={openNew}>＋ خطة تقسيط</button>}
      </div>

      <div className="list-tools">
        <button className={`btn ${tab === 'plans' ? '' : 'ghost'}`} onClick={() => setTab('plans')}>📅 خطط الأقساط</button>
        <button className={`btn ${tab === 'aging' ? '' : 'ghost'}`} onClick={() => setTab('aging')}>⏳ أعمار الديون</button>
        <button className={`btn ${tab === 'overdue' ? '' : 'ghost'}`} onClick={() => setTab('overdue')}>🔴 المتأخرون</button>
      </div>

      {/* ── Plans ── */}
      {tab === 'plans' && (
        plans.length === 0 ? (
          <div className="card empty"><div className="big-ico">💳</div><p>لا توجد خطط تقسيط — أنشئ خطة لعميل عليه رصيد</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>العميل</th><th>الإجمالي</th><th>الممول</th><th>مدفوع</th><th>المتبقي</th><th>التقدم</th><th>القسط القادم</th><th></th></tr></thead>
              <tbody>
                {plans.map((p) => {
                  const s = planSummary(p);
                  return (
                    <Fragment key={p.id}>
                      <tr className="clickable" onClick={() => setExpanded(expanded === p.id ? null : p.id)}>
                        <td><b>{p.customerName}</b>{p.status === 'completed' && <span className="badge green" style={{ marginRight: 6 }}>مكتملة</span>}{s.overdue > 0 && <span className="badge red" style={{ marginRight: 6 }}>{s.overdue} متأخر</span>}</td>
                        <td className="num">{money(p.total)}</td>
                        <td className="num muted">{money(p.financed)}</td>
                        <td className="num" style={{ color: 'var(--green)' }}>{money(s.paid)}</td>
                        <td className="num" style={{ color: 'var(--red)' }}>{money(s.remaining)}</td>
                        <td>{s.paidCount}/{p.count}</td>
                        <td className="muted">{s.next ? `${money(s.next.amount)} — ${s.next.dueDate}` : '—'}</td>
                        <td>{expanded === p.id ? '▲' : '▼'}</td>
                      </tr>
                      {expanded === p.id && (
                        <tr><td colSpan={8} style={{ background: 'var(--bg)' }}>
                          <table style={{ width: '100%' }}>
                            <thead><tr><th>#</th><th>الاستحقاق</th><th>المبلغ</th><th>مدفوع</th><th>الحالة</th><th></th></tr></thead>
                            <tbody>
                              {p.installments.map((inst) => {
                                const st = instStatus(inst);
                                return (
                                  <tr key={inst.no}>
                                    <td>{inst.no}</td>
                                    <td className="muted">{inst.dueDate}</td>
                                    <td className="num">{money(inst.amount)}</td>
                                    <td className="num">{inst.paidAmount ? money(inst.paidAmount) : '—'}</td>
                                    <td><span className={`badge ${st.cls}`}>{st.label}</span></td>
                                    <td>{inst.status !== 'paid' && <button className="btn sm" onClick={() => setPayFor({ plan: p, inst })}>تحصيل</button>}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* ── Aging ── */}
      {tab === 'aging' && (
        aging.length === 0 ? (
          <div className="card empty"><div className="big-ico">⏳</div><p>لا توجد ديون على العملاء</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>العميل</th><th>إجمالي الدين</th><th>0–30 يوم</th><th>31–60</th><th>61–90</th><th>+90 يوم</th></tr></thead>
              <tbody>
                {aging.map((r) => (
                  <tr key={r.c.id}>
                    <td><b>{r.c.name}</b>{(r.c.creditLimit || 0) > 0 && r.total > r.c.creditLimit && <span className="badge amber" style={{ marginRight: 6 }}>تجاوز الحد</span>}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{money(r.total)}</td>
                    <td className="num">{r.b0 ? money(r.b0) : '—'}</td>
                    <td className="num" style={{ color: r.b30 ? 'var(--amber)' : '' }}>{r.b30 ? money(r.b30) : '—'}</td>
                    <td className="num" style={{ color: r.b60 ? 'var(--amber)' : '' }}>{r.b60 ? money(r.b60) : '—'}</td>
                    <td className="num" style={{ color: r.b90 ? 'var(--red)' : '' }}>{r.b90 ? money(r.b90) : '—'}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: '2px solid var(--line)', fontWeight: 800 }}>
                  <td>الإجمالي</td>
                  <td className="num">{money(agingTotals.total)}</td>
                  <td className="num">{money(agingTotals.b0)}</td>
                  <td className="num">{money(agingTotals.b30)}</td>
                  <td className="num">{money(agingTotals.b60)}</td>
                  <td className="num">{money(agingTotals.b90)}</td>
                </tr>
              </tbody>
            </table>
            <p className="muted" style={{ padding: '8px 14px', fontSize: 12 }}>
              الأعمار محسوبة حسب أيام التأخير عن <b>تاريخ الاستحقاق</b> (الفواتير بلا تاريخ استحقاق تُحسب بعد {fmt(creditDays)} يوم من تاريخها)، بتوزيع الدفعات على أقدم الفواتير (FIFO). الأرصدة الافتتاحية غير المرتبطة بفواتير تظهر ضمن 0–30 يوم.
            </p>
          </div>
        )
      )}

      {/* ── Overdue customers (filter + export) ── */}
      {tab === 'overdue' && (
        <>
          <div className="card" style={{ padding: 12, marginBottom: 12 }}>
            <div className="row">
              <div className="field"><label>حد أدنى لأيام التأخير</label>
                <input className="input" type="number" min="0" value={minDays} onChange={(e) => setMinDays(e.target.value)} placeholder="مثال: 1" /></div>
              <div className="field"><label>حد أدنى للمبلغ المتأخر</label>
                <input className="input" type="number" min="0" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} placeholder="0" /></div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn ghost sm" disabled={overdueRows.length === 0}
                onClick={() => exportOverdueCustomers(overdueRows, { bizName, minDays: Number(minDays) || 0, minAmount: Number(minAmount) || 0 })}>⬇️ تصدير CSV</button>
              <button className="btn ghost sm" disabled={overdueRows.length === 0}
                onClick={() => printOverdueCustomers(overdueRows, { bizName, minDays: Number(minDays) || 0, minAmount: Number(minAmount) || 0 })}>🖨️ طباعة / PDF</button>
              <span className="meta muted" style={{ alignSelf: 'center' }}>عدد المتأخرين: {fmt(overdueRows.length)}</span>
            </div>
          </div>
          {overdue.length === 0 ? (
            <div className="card empty"><div className="big-ico">✅</div><p>لا يوجد عملاء متأخرون مطابقون للفلترة</p></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>العميل</th><th>الهاتف</th><th>أقدم استحقاق</th><th>أيام التأخير</th><th>فواتير متأخرة</th><th>المبلغ المتأخر</th><th>إجمالي الرصيد</th></tr></thead>
                <tbody>
                  {overdue.map((r) => (
                    <tr key={r.c.id}>
                      <td><b>{r.c.name}</b></td>
                      <td className="muted">{r.c.phone || '—'}</td>
                      <td className="muted">{r.oldestDue ? fmtDay(r.oldestDue) : '—'}</td>
                      <td className="num" style={{ color: r.maxOverdueDays > 90 ? 'var(--red)' : 'var(--amber)', fontWeight: 700 }}>{fmt(r.maxOverdueDays)}</td>
                      <td className="num">{fmt(r.overdueInvoices)}</td>
                      <td className="num" style={{ fontWeight: 700 }}>{money(r.overdueAmount)}</td>
                      <td className="num">{money(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── New plan modal ── */}
      {form && (
        <Modal title="خطة تقسيط جديدة" onClose={() => setForm(null)}>
          <div className="field"><label>العميل *</label>
            <select className="input" value={form.customerId} onChange={(e) => {
              const c = customers.find((x) => x.id === Number(e.target.value));
              setForm({ ...form, customerId: e.target.value, total: c && (c.balance || 0) > 0 ? String(c.balance) : form.total });
            }}>
              <option value="">اختر العميل...</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{(c.balance || 0) > 0 ? ` — عليه ${fmt(c.balance)}` : ''}</option>)}
            </select>
          </div>
          <div className="row">
            <div className="field"><label>إجمالي المبلغ *</label>
              <input className="input lg" type="number" min="0" value={form.total} onChange={(e) => setForm({ ...form, total: e.target.value })} placeholder="0" /></div>
            <div className="field"><label>الدفعة المقدمة</label>
              <input className="input" type="number" min="0" value={form.downPayment} onChange={(e) => setForm({ ...form, downPayment: e.target.value })} placeholder="0" /></div>
          </div>
          <div className="row">
            <div className="field"><label>عدد الأقساط (شهري) *</label>
              <input className="input" type="number" min="1" value={form.count} onChange={(e) => setForm({ ...form, count: e.target.value })} /></div>
            <div className="field"><label>تاريخ أول قسط</label>
              <input className="input" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></div>
          </div>
          {Number(form.total) > 0 && Number(form.count) > 0 && (
            <p className="muted">الممول: <b>{money(Math.max(0, (Number(form.total) || 0) - (Number(form.downPayment) || 0)))}</b> على <b>{form.count}</b> قسط ≈ <b>{money(Math.max(0, ((Number(form.total) || 0) - (Number(form.downPayment) || 0)) / (Number(form.count) || 1)))}</b>/شهر</p>
          )}
          <button className="btn accent big block" onClick={savePlan} disabled={!form.customerId || !(Number(form.total) > 0) || !(Number(form.count) > 0)}>💾 إنشاء الخطة</button>
        </Modal>
      )}

      {/* ── Pay installment modal ── */}
      {payFor && <PayModal payFor={payFor} onPay={doPay} onClose={() => setPayFor(null)} />}

      <Toast msg={toast} />
    </>
  );
}

function PayModal({ payFor, onPay, onClose }) {
  const due = Math.round((payFor.inst.amount - (payFor.inst.paidAmount || 0)) * 100) / 100;
  const [amount, setAmount] = useState(String(due));
  return (
    <Modal title={`تحصيل قسط #${payFor.inst.no} — ${payFor.plan.customerName}`} onClose={onClose}>
      <p className="muted">المستحق على هذا القسط: <b>{money(due)}</b> · تاريخ الاستحقاق: {fmtDay(payFor.inst.dueDate)}</p>
      <div className="field"><label>المبلغ المحصّل *</label>
        <input className="input lg" type="number" min="0" max={due} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></div>
      <button className="btn accent block" onClick={() => onPay(amount)} disabled={!(Number(amount) > 0)}>💾 تسجيل التحصيل</button>
    </Modal>
  );
}
