import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, today, postJournal, ensureChartOfAccounts, accountBalance, ACCOUNT_TYPES } from '../db';
import { money, fmt, fmtDate } from '../utils';
import { Modal, Toast } from '../components/UI';
import { useAuth } from '../auth';

const TYPE_ORDER = ['asset', 'liability', 'equity', 'revenue', 'expense'];

export default function Accounting() {
  const { user, activeBranch } = useAuth();
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], []);
  const entries = useLiveQuery(() => db.journalEntries.orderBy('createdAt').reverse().toArray(), [], []);

  const [tab, setTab] = useState('chart');
  const [from, setFrom] = useState(today().slice(0, 7) + '-01');
  const [to, setTo] = useState(today());
  const [ledgerAcc, setLedgerAcc] = useState('');
  const [toast, setToast] = useState('');
  const [acctForm, setAcctForm] = useState(null); // { code, name, type }
  const [jvForm, setJvForm] = useState(null); // { date, description, lines: [{accountId, debit, credit}] }

  const entriesInRange = useMemo(
    () => entries.filter((e) => e.day >= from && e.day <= to),
    [entries, from, to]
  );

  // ---- add account ----
  const saveAccount = async () => {
    const code = acctForm.code.trim();
    const name = acctForm.name.trim();
    if (!code || !name) return;
    if (accounts.some((a) => a.code === code)) { setToast('⚠️ كود الحساب مستخدم بالفعل'); setTimeout(() => setToast(''), 2500); return; }
    await db.accounts.add({ code, name, type: acctForm.type, role: null, parentId: null, isGroup: false, system: false, createdAt: new Date().toISOString() });
    import('../sync').then((m) => m.triggerSync()).catch(() => {});
    setAcctForm(null);
    setToast('✅ تم إضافة الحساب');
    setTimeout(() => setToast(''), 2000);
  };

  // ---- manual journal entry ----
  const openJv = () => setJvForm({ date: today(), description: '', lines: [{ accountId: '', debit: '', credit: '' }, { accountId: '', debit: '', credit: '' }] });
  const setJvLine = (i, patch) => setJvForm((f) => ({ ...f, lines: f.lines.map((l, idx) => idx === i ? { ...l, ...patch } : l) }));
  const addJvLine = () => setJvForm((f) => ({ ...f, lines: [...f.lines, { accountId: '', debit: '', credit: '' }] }));
  const removeJvLine = (i) => setJvForm((f) => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }));

  const jvTotals = useMemo(() => {
    if (!jvForm) return { d: 0, c: 0 };
    return jvForm.lines.reduce((s, l) => ({ d: s.d + Number(l.debit || 0), c: s.c + Number(l.credit || 0) }), { d: 0, c: 0 });
  }, [jvForm]);
  const jvBalanced = jvForm && jvTotals.d > 0 && Math.abs(jvTotals.d - jvTotals.c) < 0.01;

  const saveJv = async () => {
    const lines = jvForm.lines
      .filter((l) => l.accountId && (Number(l.debit) > 0 || Number(l.credit) > 0))
      .map((l) => ({ accountId: Number(l.accountId), debit: Number(l.debit || 0), credit: Number(l.credit || 0) }));
    const res = await postJournal({
      date: jvForm.date, description: jvForm.description.trim() || 'قيد يدوي',
      refType: 'manual', branchId: activeBranch, lines, userId: user.id, userName: user.name,
    });
    if (res) { setToast(`✅ تم حفظ القيد ${res.number}`); setJvForm(null); }
    else { setToast('⚠️ القيد غير متوازن أو غير صالح'); }
    setTimeout(() => setToast(''), 3000);
  };

  const accountsByType = useMemo(() => {
    const m = {}; for (const t of TYPE_ORDER) m[t] = [];
    for (const a of [...accounts].sort((x, y) => (x.code || '').localeCompare(y.code || ''))) {
      if (m[a.type]) m[a.type].push(a);
    }
    return m;
  }, [accounts]);

  // trial balance rows
  const trial = useMemo(() => {
    const rows = accounts.map((a) => {
      let debit = 0, credit = 0;
      for (const e of entriesInRange) for (const l of (e.lines || [])) {
        if (l.accountId === a.id) { debit += Number(l.debit || 0); credit += Number(l.credit || 0); }
      }
      const net = debit - credit;
      return { a, debit, credit, net };
    }).filter((r) => Math.abs(r.debit) > 0.001 || Math.abs(r.credit) > 0.001);
    const totDebit = rows.reduce((s, r) => s + (r.net > 0 ? r.net : 0), 0);
    const totCredit = rows.reduce((s, r) => s + (r.net < 0 ? -r.net : 0), 0);
    return { rows, totDebit, totCredit };
  }, [accounts, entriesInRange]);

  // income statement
  const income = useMemo(() => {
    const rev = [], exp = [];
    for (const a of accounts) {
      if (a.type !== 'revenue' && a.type !== 'expense') continue;
      const bal = accountBalance(a, entriesInRange);
      if (Math.abs(bal) < 0.001) continue;
      (a.type === 'revenue' ? rev : exp).push({ a, bal });
    }
    const totRev = rev.reduce((s, r) => s + r.bal, 0);
    const totExp = exp.reduce((s, r) => s + r.bal, 0);
    return { rev, exp, totRev, totExp, net: totRev - totExp };
  }, [accounts, entriesInRange]);

  // general ledger for a chosen account
  const ledger = useMemo(() => {
    if (!ledgerAcc) return null;
    const acc = accounts.find((a) => a.id === Number(ledgerAcc));
    if (!acc) return null;
    const creditNormal = ACCOUNT_TYPES[acc.type]?.normal === 'credit';
    const rows = [];
    let running = 0;
    const chron = [...entriesInRange].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    for (const e of chron) for (const l of (e.lines || [])) {
      if (l.accountId !== acc.id) continue;
      const delta = creditNormal ? (l.credit - l.debit) : (l.debit - l.credit);
      running += delta;
      rows.push({ e, debit: l.debit, credit: l.credit, running });
    }
    return { acc, rows };
  }, [ledgerAcc, accounts, entriesInRange]);

  const needsSeed = accounts.length === 0;

  return (
    <>
      <div className="page-head"><h1>📒 المحاسبة</h1></div>

      {needsSeed && (
        <div className="card" style={{ marginBottom: 14 }}>
          <p>لم يتم إنشاء دليل الحسابات بعد.</p>
          <button className="btn accent" onClick={async () => { await ensureChartOfAccounts(); setToast('✅ تم إنشاء دليل الحسابات'); setTimeout(() => setToast(''), 2000); }}>
            إنشاء دليل الحسابات الافتراضي
          </button>
        </div>
      )}

      <div className="list-tools" style={{ flexWrap: 'wrap' }}>
        <button className={`btn ${tab === 'chart' ? '' : 'ghost'}`} onClick={() => setTab('chart')}>📚 دليل الحسابات</button>
        <button className={`btn ${tab === 'journal' ? '' : 'ghost'}`} onClick={() => setTab('journal')}>📝 القيود</button>
        <button className={`btn ${tab === 'trial' ? '' : 'ghost'}`} onClick={() => setTab('trial')}>⚖️ ميزان المراجعة</button>
        <button className={`btn ${tab === 'income' ? '' : 'ghost'}`} onClick={() => setTab('income')}>📈 قائمة الدخل</button>
        <button className={`btn ${tab === 'ledger' ? '' : 'ghost'}`} onClick={() => setTab('ledger')}>📖 الأستاذ العام</button>
      </div>

      {(tab === 'trial' || tab === 'income' || tab === 'ledger') && (
        <div className="list-tools">
          <span className="muted" style={{ alignSelf: 'center', fontSize: 13 }}>الفترة من</span>
          <input className="input" style={{ maxWidth: 155 }} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="muted" style={{ alignSelf: 'center', fontSize: 13 }}>إلى</span>
          <input className="input" style={{ maxWidth: 155 }} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          {tab === 'ledger' && (
            <select className="input" style={{ maxWidth: 260 }} value={ledgerAcc} onChange={(e) => setLedgerAcc(e.target.value)}>
              <option value="">اختر الحساب...</option>
              {[...accounts].sort((a, b) => (a.code || '').localeCompare(b.code || '')).map((a) => (
                <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* ── Chart of accounts ── */}
      {tab === 'chart' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '10px 0' }}>
            <button className="btn accent" onClick={() => setAcctForm({ code: '', name: '', type: 'asset' })}>＋ حساب جديد</button>
          </div>
          {TYPE_ORDER.map((t) => accountsByType[t] && accountsByType[t].length > 0 && (
            <div className="card" key={t} style={{ marginBottom: 12 }}>
              <h3 style={{ marginTop: 0 }}>{ACCOUNT_TYPES[t].label}</h3>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>الكود</th><th>الحساب</th><th>الرصيد</th></tr></thead>
                  <tbody>
                    {accountsByType[t].map((a) => (
                      <tr key={a.id}>
                        <td className="num muted">{a.code}</td>
                        <td>{a.name}{a.system && <span className="badge gray" style={{ marginRight: 6, fontSize: 10 }}>نظامي</span>}</td>
                        <td className="num">{money(accountBalance(a, entries))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </>
      )}

      {/* ── Journal ── */}
      {tab === 'journal' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '10px 0' }}>
            <button className="btn accent" onClick={openJv}>＋ قيد يدوي</button>
          </div>
          {entries.length === 0 ? (
            <div className="card empty"><div className="big-ico">📝</div><p>لا توجد قيود بعد — أي عملية بيع/شراء/دفع تنشئ قيدها تلقائياً</p></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>رقم</th><th>التاريخ</th><th>البيان</th><th>مدين</th><th>دائن</th></tr></thead>
                <tbody>
                  {entries.slice(0, 200).map((e) => (
                    <tr key={e.id}>
                      <td className="num">{e.number}</td>
                      <td className="muted">{e.day}</td>
                      <td>{e.description}
                        <div className="meta muted" style={{ fontSize: 11 }}>
                          {(e.lines || []).map((l) => `${l.name} ${l.debit ? `مدين ${fmt(l.debit)}` : `دائن ${fmt(l.credit)}`}`).join(' · ')}
                        </div>
                      </td>
                      <td className="num">{money(e.totalDebit)}</td>
                      <td className="num">{money(e.totalCredit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── Trial balance ── */}
      {tab === 'trial' && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>الكود</th><th>الحساب</th><th>مدين</th><th>دائن</th></tr></thead>
            <tbody>
              {trial.rows.length === 0 ? (
                <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 20 }}>لا توجد حركات في هذه الفترة</td></tr>
              ) : trial.rows.map((r) => (
                <tr key={r.a.id}>
                  <td className="num muted">{r.a.code}</td>
                  <td>{r.a.name}</td>
                  <td className="num">{r.net > 0 ? money(r.net) : '—'}</td>
                  <td className="num">{r.net < 0 ? money(-r.net) : '—'}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--line)', fontWeight: 800 }}>
                <td></td><td>الإجمالي</td>
                <td className="num">{money(trial.totDebit)}</td>
                <td className="num">{money(trial.totCredit)}</td>
              </tr>
              <tr>
                <td></td><td className="muted">التوازن</td>
                <td colSpan={2} style={{ textAlign: 'center' }}>
                  {Math.abs(trial.totDebit - trial.totCredit) < 0.01
                    ? <span className="badge green">متوازن ✓</span>
                    : <span className="badge red">فرق {money(Math.abs(trial.totDebit - trial.totCredit))}</span>}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* ── Income statement ── */}
      {tab === 'income' && (
        <div className="card" style={{ maxWidth: 640 }}>
          <h3 style={{ marginTop: 0 }}>قائمة الدخل — {from} إلى {to}</h3>
          <div className="totals">
            <div className="trow" style={{ fontWeight: 700 }}><span>الإيرادات</span><span /></div>
            {income.rev.map((r) => (
              <div className="trow" key={r.a.id}><span style={{ paddingRight: 12 }}>{r.a.name}</span><span className="num">{money(r.bal)}</span></div>
            ))}
            <div className="trow" style={{ borderTop: '1px solid var(--line)' }}><span>إجمالي الإيرادات</span><span className="num">{money(income.totRev)}</span></div>
            <div className="trow" style={{ fontWeight: 700, marginTop: 8 }}><span>المصروفات</span><span /></div>
            {income.exp.map((r) => (
              <div className="trow" key={r.a.id}><span style={{ paddingRight: 12 }}>{r.a.name}</span><span className="num">{money(r.bal)}</span></div>
            ))}
            <div className="trow" style={{ borderTop: '1px solid var(--line)' }}><span>إجمالي المصروفات</span><span className="num">{money(income.totExp)}</span></div>
            <div className="trow grand" style={{ color: income.net >= 0 ? 'var(--green)' : 'var(--red)' }}>
              <span>صافي {income.net >= 0 ? 'الربح' : 'الخسارة'}</span><span className="num">{money(income.net)}</span>
            </div>
          </div>
        </div>
      )}

      {/* ── General ledger ── */}
      {tab === 'ledger' && (
        !ledger ? (
          <div className="card empty"><div className="big-ico">📖</div><p>اختر حساباً لعرض حركته</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>التاريخ</th><th>القيد</th><th>البيان</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead>
              <tbody>
                {ledger.rows.length === 0 ? (
                  <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 20 }}>لا توجد حركات</td></tr>
                ) : ledger.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="muted">{r.e.day}</td>
                    <td className="num muted">{r.e.number}</td>
                    <td>{r.e.description}</td>
                    <td className="num">{r.debit ? money(r.debit) : '—'}</td>
                    <td className="num">{r.credit ? money(r.credit) : '—'}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{money(r.running)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* ── Add account modal ── */}
      {acctForm && (
        <Modal title="حساب جديد" onClose={() => setAcctForm(null)}>
          <div className="row">
            <div className="field"><label>الكود *</label>
              <input className="input" value={acctForm.code} autoFocus onChange={(e) => setAcctForm({ ...acctForm, code: e.target.value })} placeholder="مثال: 5400" /></div>
            <div className="field"><label>النوع *</label>
              <select className="input" value={acctForm.type} onChange={(e) => setAcctForm({ ...acctForm, type: e.target.value })}>
                {TYPE_ORDER.map((t) => <option key={t} value={t}>{ACCOUNT_TYPES[t].label}</option>)}
              </select></div>
          </div>
          <div className="field"><label>اسم الحساب *</label>
            <input className="input" value={acctForm.name} onChange={(e) => setAcctForm({ ...acctForm, name: e.target.value })} placeholder="مثال: مصاريف كهرباء" /></div>
          <button className="btn block" onClick={saveAccount} disabled={!acctForm.code.trim() || !acctForm.name.trim()}>💾 حفظ</button>
        </Modal>
      )}

      {/* ── Manual journal entry modal ── */}
      {jvForm && (
        <Modal title="قيد يومية يدوي" onClose={() => setJvForm(null)}>
          <div className="row">
            <div className="field"><label>التاريخ</label>
              <input className="input" type="date" value={jvForm.date} onChange={(e) => setJvForm({ ...jvForm, date: e.target.value })} /></div>
            <div className="field"><label>البيان</label>
              <input className="input" value={jvForm.description} onChange={(e) => setJvForm({ ...jvForm, description: e.target.value })} placeholder="وصف القيد" /></div>
          </div>
          <div className="table-wrap" style={{ marginBottom: 8 }}>
            <table>
              <thead><tr><th>الحساب</th><th>مدين</th><th>دائن</th><th></th></tr></thead>
              <tbody>
                {jvForm.lines.map((l, i) => (
                  <tr key={i}>
                    <td>
                      <select className="input" value={l.accountId} onChange={(e) => setJvLine(i, { accountId: e.target.value })}>
                        <option value="">—</option>
                        {[...accounts].sort((a, b) => (a.code || '').localeCompare(b.code || '')).map((a) => (
                          <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ maxWidth: 100 }}><input className="input" type="number" min="0" value={l.debit} onChange={(e) => setJvLine(i, { debit: e.target.value, credit: '' })} /></td>
                    <td style={{ maxWidth: 100 }}><input className="input" type="number" min="0" value={l.credit} onChange={(e) => setJvLine(i, { credit: e.target.value, debit: '' })} /></td>
                    <td>{jvForm.lines.length > 2 && <button className="x" onClick={() => removeJvLine(i)}>✕</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn ghost sm" onClick={addJvLine}>＋ سطر</button>
          <div className="totals" style={{ margin: '10px 0' }}>
            <div className="trow"><span>إجمالي المدين</span><span className="num">{money(jvTotals.d)}</span></div>
            <div className="trow"><span>إجمالي الدائن</span><span className="num">{money(jvTotals.c)}</span></div>
            <div className="trow"><span>التوازن</span><span>{jvBalanced ? <span className="badge green">متوازن ✓</span> : <span className="badge amber">فرق {money(Math.abs(jvTotals.d - jvTotals.c))}</span>}</span></div>
          </div>
          <button className="btn accent big block" onClick={saveJv} disabled={!jvBalanced}>💾 حفظ القيد</button>
        </Modal>
      )}

      <Toast msg={toast} />
    </>
  );
}
