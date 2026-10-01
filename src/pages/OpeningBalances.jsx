import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSetting, setPartyOpening, postOpeningInventory, totalStock } from '../db';
import { money, fmt } from '../utils';
import { useAuth } from '../auth';
import { Toast } from '../components/UI';

export default function OpeningBalances() {
  const { user } = useAuth();
  const [tab, setTab] = useState('customers');
  const [toast, setToast] = useState('');
  const notify = (m) => { setToast(m); setTimeout(() => setToast(''), 2800); };

  return (
    <>
      <div className="page-head"><h1>⚖️ الأرصدة الافتتاحية</h1></div>
      <div className="card" style={{ marginBottom: 12 }}>
        <p className="muted" style={{ margin: 0 }}>
          لما تبدأ البرنامج وعندك بيانات قديمة (ديون/مخزون/كاش من قبل)، تدخلها هنا مرة واحدة
          كـ<b>رصيد أول المدة</b> عشان الحسابات والميزانية تطلع صح. كل إدخال بيتسجّل بقيد افتتاحي
          متوازن، وتقدر تعدّله لاحقًا — البرنامج بيرحّل الفرق بس فمش هيتكرّر.
        </p>
      </div>

      <div className="tabs" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        <button className={`btn ${tab === 'customers' ? '' : 'ghost'}`} onClick={() => setTab('customers')}>👥 العملاء</button>
        <button className={`btn ${tab === 'suppliers' ? '' : 'ghost'}`} onClick={() => setTab('suppliers')}>🏭 الموردون</button>
        <button className={`btn ${tab === 'inventory' ? '' : 'ghost'}`} onClick={() => setTab('inventory')}>📦 المخزون</button>
        <button className={`btn ${tab === 'cash' ? '' : 'ghost'}`} onClick={() => setTab('cash')}>💵 الكاش/البنك</button>
      </div>

      {tab === 'customers' && <PartyOpenings kind="customer" userName={user.name} notify={notify} />}
      {tab === 'suppliers' && <PartyOpenings kind="supplier" userName={user.name} notify={notify} />}
      {tab === 'inventory' && <InventoryOpening userName={user.name} notify={notify} />}
      {tab === 'cash' && <CashOpening />}

      <Toast msg={toast} />
    </>
  );
}

function PartyOpenings({ kind, userName, notify }) {
  const isCust = kind === 'customer';
  const list = useLiveQuery(() => (isCust ? db.customers : db.suppliers).orderBy('name').toArray(), [kind], []);
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState({}); // { [id]: typedValue }
  const [busy, setBusy] = useState(0);

  const filtered = (list || []).filter((p) => {
    const t = q.trim().toLowerCase();
    return !t || (p.name || '').toLowerCase().includes(t) || (p.phone || '').includes(t);
  });

  const save = async (p) => {
    const raw = draft[p.id];
    const amount = Number(raw);
    if (raw == null || raw === '' || Number.isNaN(amount)) { notify('اكتب رقم صحيح'); return; }
    setBusy(p.id);
    try {
      await setPartyOpening({ partyType: kind, partyId: p.id, amount, userName });
      notify(`✅ تم ضبط الرصيد الافتتاحي لـ ${p.name}`);
      setDraft((d) => { const n = { ...d }; delete n[p.id]; return n; });
    } catch (e) { notify('❌ ' + e.message); }
    setBusy(0);
  };

  return (
    <>
      <div className="list-tools" style={{ marginBottom: 10 }}>
        <input className="input" placeholder="🔍 بحث بالاسم / الهاتف..." value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        {isCust
          ? 'أدخل المبلغ اللي على كل عميل من قبل البرنامج (دين عليه لصالحك).'
          : 'أدخل المبلغ اللي لكل مورد عليك من قبل البرنامج (مستحق له).'}
      </p>
      {filtered.length === 0 ? (
        <div className="card empty">لا يوجد {isCust ? 'عملاء' : 'موردون'} بعد — أضفهم أولًا من صفحتهم.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>الاسم</th><th>الرصيد الحالي</th><th>رصيد افتتاحي مُسجّل</th><th>تعديل الرصيد الافتتاحي</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const opened = Number(p.openingBalance || 0);
                const val = draft[p.id] != null ? draft[p.id] : String(opened || '');
                return (
                  <tr key={p.id}>
                    <td><b>{p.name}</b>{p.phone ? <span className="muted" style={{ fontSize: 12 }}> · {p.phone}</span> : ''}</td>
                    <td className="num" style={{ color: (p.balance || 0) > 0 ? 'var(--red)' : 'var(--green)' }}>{money(p.balance)}</td>
                    <td className="num muted">{opened ? money(opened) : '—'}</td>
                    <td>
                      <input className="input" type="number" min="0" style={{ maxWidth: 140 }}
                        value={val}
                        onChange={(e) => setDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                        placeholder="0" />
                    </td>
                    <td>
                      <button className="btn ghost sm" disabled={busy === p.id} onClick={() => save(p)}>💾 حفظ</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function InventoryOpening({ userName, notify }) {
  const items = useLiveQuery(() => db.items.toArray(), [], []);
  const posted = useLiveQuery(() => getSetting('openingInventoryValue', 0), [], 0);
  const [busy, setBusy] = useState(false);
  const currentValue = (items || []).reduce((s, it) => s + totalStock(it) * (it.costPrice || 0), 0);
  const diff = currentValue - (Number(posted) || 0);

  const post = async () => {
    setBusy(true);
    try {
      await postOpeningInventory({ value: currentValue, userName });
      notify('✅ تم ترحيل قيمة المخزون كرصيد افتتاحي');
    } catch (e) { notify('❌ ' + e.message); }
    setBusy(false);
  };

  return (
    <div className="card">
      <p className="muted" style={{ marginTop: 0 }}>
        دخّل كميات المخزون أول المدة من <Link to="/items">صفحة الأصناف</Link> بأسعار التكلفة،
        وبعدين اضغط هنا لترحيل <b>قيمتها</b> كرصيد افتتاحي في المحاسبة (مدين: المخزون / دائن: رأس المال).
      </p>
      <div className="kpis" style={{ marginBottom: 12 }}>
        <div className="kpi"><div className="label">قيمة المخزون الحالية (بالتكلفة)</div><div className="value">{money(currentValue)}</div><div className="sub">{(items || []).length} صنف</div></div>
        <div className="kpi"><div className="label">المُرحَّل سابقًا كافتتاحي</div><div className="value">{money(Number(posted) || 0)}</div></div>
        <div className={`kpi ${diff !== 0 ? 'tone-amber' : 'tone-green'}`}><div className="label">الفرق اللي هيتسجّل</div><div className="value">{money(diff)}</div></div>
      </div>
      <button className="btn big" disabled={busy || diff === 0} onClick={post}>
        {diff === 0 ? '✓ المخزون مُرحَّل بالكامل' : '⚖️ ترحيل قيمة المخزون كرصيد افتتاحي'}
      </button>
    </div>
  );
}

function CashOpening() {
  const cashboxes = useLiveQuery(() => db.accounts.filter((a) => a.cashbox === true).toArray(), [], []);
  return (
    <div className="card">
      <p className="muted" style={{ marginTop: 0 }}>
        رصيد الكاش/البنك الافتتاحي بيتسجّل وقت إنشاء الخزنة من صفحة <Link to="/treasury">الخزائن</Link>
        (حقل «الرصيد الافتتاحي» — بيعمل قيد: مدين الخزنة / دائن رأس المال). دي الخزائن الحالية:
      </p>
      {(cashboxes || []).length === 0 ? (
        <div className="empty">لا توجد خزائن بعد — أنشئ خزنة/بنك من صفحة الخزائن وحدّد رصيدها الافتتاحي.</div>
      ) : (
        <ul style={{ margin: 0, paddingInlineStart: 18 }}>
          {cashboxes.map((c) => <li key={c.id}>{c.cbType === 'bank' ? '🏦' : '💵'} {c.name}</li>)}
        </ul>
      )}
      <Link to="/treasury" className="btn ghost" style={{ marginTop: 10 }}>↗ فتح صفحة الخزائن</Link>
    </div>
  );
}
