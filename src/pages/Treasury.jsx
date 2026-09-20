import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, today, createCashbox, postCashMovement, postCashTransfer, accountBalance, ACCOUNT_TYPES } from '../db';
import { money, fmt } from '../utils';
import { Modal, Toast } from '../components/UI';
import { useAuth } from '../auth';

export default function Treasury() {
  const { user, activeBranch } = useAuth();
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], []);
  const entries = useLiveQuery(() => db.journalEntries.orderBy('createdAt').reverse().toArray(), [], []);

  const [toast, setToast] = useState('');
  const [modal, setModal] = useState(null); // 'new' | 'in' | 'out' | 'transfer'
  const [form, setForm] = useState({});
  const [stmtId, setStmtId] = useState(''); // cashbox to show statement for
  const [actualBal, setActualBal] = useState('');

  const cashboxes = useMemo(
    () => accounts.filter((a) => a.cashbox).sort((a, b) => (a.code || '').localeCompare(b.code || '')),
    [accounts]
  );
  const counterAccounts = useMemo(
    () => accounts.filter((a) => !a.cashbox).sort((a, b) => (a.code || '').localeCompare(b.code || '')),
    [accounts]
  );
  const balOf = (acc) => accountBalance(acc, entries);
  const totalCash = cashboxes.reduce((s, c) => s + balOf(c), 0);

  const open = (kind) => {
    const firstCb = cashboxes[0]?.id || '';
    const firstCounter = counterAccounts[0]?.id || '';
    setForm({
      name: '', cbType: 'cash', openingBalance: '',
      cashboxId: firstCb, counterAccountId: firstCounter,
      fromId: firstCb, toId: cashboxes[1]?.id || firstCb,
      amount: '', description: '', day: today(),
    });
    setModal(kind);
  };

  const notify = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const submit = async () => {
    try {
      if (modal === 'new') {
        await createCashbox({ name: form.name, cbType: form.cbType, openingBalance: Number(form.openingBalance || 0), branchId: activeBranch, userName: user.name });
        notify('✅ تم إنشاء الخزينة');
      } else if (modal === 'in' || modal === 'out') {
        await postCashMovement({ cashboxId: form.cashboxId, direction: modal, counterAccountId: form.counterAccountId, amount: form.amount, description: form.description, day: form.day, branchId: activeBranch, userName: user.name });
        notify(modal === 'in' ? '✅ تم تسجيل سند القبض' : '✅ تم تسجيل سند الصرف');
      } else if (modal === 'transfer') {
        await postCashTransfer({ fromId: form.fromId, toId: form.toId, amount: form.amount, description: form.description, day: form.day, branchId: activeBranch, userName: user.name });
        notify('✅ تم التحويل بين الخزائن');
      }
      setModal(null);
    } catch (e) {
      notify('⚠️ ' + (e.message || 'تعذّر الحفظ'));
    }
  };

  // statement (ledger) for the selected cashbox
  const statement = useMemo(() => {
    if (!stmtId) return null;
    const acc = accounts.find((a) => a.id === Number(stmtId));
    if (!acc) return null;
    const rows = [];
    let running = 0;
    const chron = [...entries].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    for (const e of chron) for (const l of (e.lines || [])) {
      if (l.accountId !== acc.id) continue;
      running += Number(l.debit || 0) - Number(l.credit || 0); // cashbox is debit-normal
      rows.push({ e, debit: l.debit, credit: l.credit, running });
    }
    rows.reverse();
    return { acc, rows, balance: running };
  }, [stmtId, accounts, entries]);

  const canSubmit = () => {
    if (modal === 'new') return form.name.trim();
    if (modal === 'in' || modal === 'out') return form.cashboxId && form.counterAccountId && Number(form.amount) > 0;
    if (modal === 'transfer') return form.fromId && form.toId && form.fromId !== form.toId && Number(form.amount) > 0;
    return false;
  };

  return (
    <>
      <div className="page-head">
        <h1>🏦 الخزائن والبنوك</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn accent" onClick={() => open('in')}>⬇️ سند قبض</button>
          <button className="btn" onClick={() => open('out')}>⬆️ سند صرف</button>
          <button className="btn ghost" onClick={() => open('transfer')} disabled={cashboxes.length < 2}>🔄 تحويل</button>
          <button className="btn ghost" onClick={() => open('new')}>＋ خزينة/بنك</button>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi tone-green">
          <div className="label">إجمالي السيولة</div>
          <div className="value">{money(totalCash)}</div>
          <div className="sub">{cashboxes.length} خزينة/بنك</div>
        </div>
        {cashboxes.map((c) => (
          <div className="kpi" key={c.id} style={{ cursor: 'pointer' }} onClick={() => setStmtId(String(c.id))}>
            <div className="label">{c.cbType === 'bank' ? '🏦' : '💵'} {c.name}</div>
            <div className="value">{money(balOf(c))}</div>
            <div className="sub">كشف الحساب ›</div>
          </div>
        ))}
      </div>

      {statement && (
        <div className="card" style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0 }}>كشف حساب: {statement.acc.name} — الرصيد {money(statement.balance)}</h3>
            <button className="btn ghost sm" onClick={() => { setStmtId(''); setActualBal(''); }}>✕ إغلاق</button>
          </div>

          {statement.acc.cbType === 'bank' && (
            <div className="card" style={{ background: 'var(--bg)', margin: '10px 0', padding: 10 }}>
              <div className="field" style={{ margin: 0 }}>
                <label>🔍 مطابقة بنكية — أدخل رصيد كشف البنك الفعلي</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input className="input" type="number" style={{ maxWidth: 180 }} value={actualBal}
                    onChange={(e) => setActualBal(e.target.value)} placeholder="رصيد البنك الفعلي" />
                  {actualBal !== '' && (
                    Math.abs(Number(actualBal) - statement.balance) < 0.01
                      ? <span className="badge green">مطابق ✓</span>
                      : <span className="badge amber">فرق {money(Number(actualBal) - statement.balance)}</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {statement.rows.length === 0 ? (
            <p className="muted">لا توجد حركات على هذه الخزينة بعد.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>التاريخ</th><th>القيد</th><th>البيان</th><th>وارد</th><th>صادر</th><th>الرصيد</th></tr></thead>
                <tbody>
                  {statement.rows.map((r, i) => (
                    <tr key={i}>
                      <td className="muted">{r.e.day}</td>
                      <td className="num muted">{r.e.number}</td>
                      <td>{r.e.description}</td>
                      <td className="num" style={{ color: 'var(--green)' }}>{r.debit ? money(r.debit) : '—'}</td>
                      <td className="num" style={{ color: 'var(--red)' }}>{r.credit ? money(r.credit) : '—'}</td>
                      <td className="num" style={{ fontWeight: 700 }}>{money(r.running)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {cashboxes.length === 0 && (
        <div className="card empty"><div className="big-ico">🏦</div><p>لا توجد خزائن — أضف خزينة أو حساب بنكي</p></div>
      )}

      {/* modals */}
      {modal && (
        <Modal
          title={modal === 'new' ? 'خزينة / بنك جديد' : modal === 'in' ? 'سند قبض' : modal === 'out' ? 'سند صرف' : 'تحويل بين الخزائن'}
          onClose={() => setModal(null)}
        >
          {modal === 'new' && (
            <>
              <div className="field"><label>الاسم *</label>
                <input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="مثال: خزينة الفرع / بنك مصر" /></div>
              <div className="row">
                <div className="field"><label>النوع</label>
                  <select className="input" value={form.cbType} onChange={(e) => setForm({ ...form, cbType: e.target.value })}>
                    <option value="cash">💵 خزينة نقدية</option>
                    <option value="bank">🏦 حساب بنكي</option>
                  </select></div>
                <div className="field"><label>رصيد افتتاحي</label>
                  <input className="input" type="number" min="0" value={form.openingBalance} onChange={(e) => setForm({ ...form, openingBalance: e.target.value })} placeholder="0" /></div>
              </div>
            </>
          )}

          {(modal === 'in' || modal === 'out') && (
            <>
              <div className="row">
                <div className="field"><label>الخزينة *</label>
                  <select className="input" value={form.cashboxId} onChange={(e) => setForm({ ...form, cashboxId: e.target.value })}>
                    {cashboxes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select></div>
                <div className="field"><label>المبلغ *</label>
                  <input className="input lg" type="number" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0" /></div>
              </div>
              <div className="field"><label>{modal === 'in' ? 'مصدر المبلغ (حساب مقابل) *' : 'وجه الصرف (حساب مقابل) *'}</label>
                <select className="input" value={form.counterAccountId} onChange={(e) => setForm({ ...form, counterAccountId: e.target.value })}>
                  {counterAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name} ({ACCOUNT_TYPES[a.type]?.label})</option>)}
                </select></div>
              <div className="row">
                <div className="field"><label>التاريخ</label>
                  <input className="input" type="date" value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value })} /></div>
                <div className="field"><label>البيان</label>
                  <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="وصف اختياري" /></div>
              </div>
            </>
          )}

          {modal === 'transfer' && (
            <>
              <div className="row">
                <div className="field"><label>من خزينة *</label>
                  <select className="input" value={form.fromId} onChange={(e) => setForm({ ...form, fromId: e.target.value })}>
                    {cashboxes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select></div>
                <div className="field"><label>إلى خزينة *</label>
                  <select className="input" value={form.toId} onChange={(e) => setForm({ ...form, toId: e.target.value })}>
                    {cashboxes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select></div>
              </div>
              <div className="row">
                <div className="field"><label>المبلغ *</label>
                  <input className="input lg" type="number" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0" /></div>
                <div className="field"><label>التاريخ</label>
                  <input className="input" type="date" value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value })} /></div>
              </div>
              <div className="field"><label>البيان</label>
                <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="وصف اختياري" /></div>
            </>
          )}

          <button className="btn accent big block" onClick={submit} disabled={!canSubmit()}>💾 حفظ</button>
        </Modal>
      )}

      <Toast msg={toast} />
    </>
  );
}
