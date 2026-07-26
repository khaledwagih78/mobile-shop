import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, nowISO, recordPayment, queueSync, getSetting } from '../db';
import { money, fmt, fmtDate, waLink } from '../utils';
import { useAuth } from '../auth';
import { Modal } from '../components/UI';

export default function Parties({ kind = 'customer' }) {
  const isCustomer = kind === 'customer';
  const table = isCustomer ? db.customers : db.suppliers;
  const { user } = useAuth();
  const list = useLiveQuery(() => table.orderBy('name').toArray(), [kind], []);
  const bizName = useLiveQuery(() => getSetting('bizName', 'خالد لقطع غيار المحمول'), [], 'خالد لقطع غيار المحمول');
  const waMsg = (c) =>
    `السلام عليكم أ/ ${c.name} 🌹\n` +
    ((c.balance || 0) > 0 ? `تذكير ودّي: إجمالي المستحق ${money(c.balance)}.\nنرجو التكرم بالسداد في أقرب وقت.\n` : '') +
    `مع تحيات ${bizName}`;
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [sortBy, setSortBy] = useState('name');
  const [form, setForm] = useState(null);
  const [view, setView] = useState(null);
  const [payFor, setPayFor] = useState(null);

  const filtered = useMemo(() => {
    let l = list || [];
    const t = q.trim().toLowerCase();
    if (t) l = l.filter((c) =>
      (c.name || '').toLowerCase().includes(t) ||
      (c.phone || '').includes(t) ||
      (c.address || '').toLowerCase().includes(t)
    );
    if (filter === 'debtors') l = l.filter((c) => (c.balance || 0) > 0);
    if (filter === 'clear') l = l.filter((c) => (c.balance || 0) <= 0);
    if (filter === 'topPoints' && isCustomer) l = [...l].sort((a, b) => (b.points || 0) - (a.points || 0));
    else l = [...l].sort((a, b) => {
      if (sortBy === 'balance') return (b.balance || 0) - (a.balance || 0);
      if (sortBy === 'points') return (b.points || 0) - (a.points || 0);
      return (a.name || '').localeCompare(b.name || '', 'ar');
    });
    return l;
  }, [list, q, filter, sortBy, isCustomer]);

  const totalDebt = (list || []).reduce((s, c) => s + Math.max(0, c.balance || 0), 0);
  const totalPoints = isCustomer ? (list || []).reduce((s, c) => s + (c.points || 0), 0) : 0;

  const save = async () => {
    if (form.id) {
      await table.update(form.id, { name: form.name, phone: form.phone, address: form.address });
    } else {
      await table.add({ ...form, balance: 0, points: 0, totalSpent: 0, createdAt: nowISO() });
    }
    await queueSync(isCustomer ? 'customers' : 'suppliers', form.id ? 'update' : 'add', form);
    setForm(null);
  };

  return (
    <>
      <div className="page-head">
        <h1>{isCustomer ? '👥 العملاء' : '🚚 الموردين'} <span className="muted" style={{ fontSize: 14 }}>({list?.length || 0})</span></h1>
        <button className="btn" onClick={() => setForm({ name: '', phone: '', address: '' })}>＋ {isCustomer ? 'عميل' : 'مورد'} جديد</button>
      </div>

      <div className="kpis">
        <div className="kpi tone-red">
          <div className="label">{isCustomer ? 'إجمالي ديون العملاء' : 'إجمالي المستحق للموردين'}</div>
          <div className="value">{money(totalDebt)}</div>
        </div>
        {isCustomer && (
          <div className="kpi tone-accent">
            <div className="label">⭐ إجمالي النقاط</div>
            <div className="value">{fmt(totalPoints)}</div>
            <div className="sub">1 نقطة لكل 100 ج.م شراء</div>
          </div>
        )}
      </div>

      <div className="list-tools">
        <input className="input" placeholder="🔍 بحث بالاسم أو الهاتف أو العنوان..." value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" style={{ maxWidth: 150 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">الكل</option>
          <option value="debtors">عليهم رصيد</option>
          <option value="clear">خالصين</option>
          {isCustomer && <option value="topPoints">⭐ أعلى نقاط</option>}
        </select>
        <select className="input" style={{ maxWidth: 140 }} value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          <option value="name">ترتيب بالاسم</option>
          <option value="balance">ترتيب بالرصيد</option>
          {isCustomer && <option value="points">ترتيب بالنقاط</option>}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="card empty"><div className="big-ico">👥</div><p>لا يوجد {isCustomer ? 'عملاء' : 'موردين'}</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>الاسم</th>
                <th>الهاتف</th>
                <th>العنوان</th>
                {isCustomer && <th>⭐ النقاط</th>}
                {isCustomer && <th>إجمالي المشتريات</th>}
                <th>الرصيد</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td><b>{c.name}</b></td>
                  <td className="num">{c.phone || '—'}</td>
                  <td className="muted">{c.address || '—'}</td>
                  {isCustomer && <td>{(c.points || 0) > 0 ? <span className="badge accent">⭐ {c.points}</span> : '—'}</td>}
                  {isCustomer && <td className="num muted">{c.totalSpent ? money(c.totalSpent) : '—'}</td>}
                  <td>
                    {(c.balance || 0) > 0
                      ? <span className="badge red">{isCustomer ? 'عليه' : 'له'} {money(c.balance)}</span>
                      : <span className="badge green">خالص</span>}
                  </td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    {c.phone && (
                      <a className="btn ghost sm" style={{ color: 'var(--green)' }} target="_blank" rel="noreferrer"
                        href={waLink(c.phone, waMsg(c))}>📲 واتساب</a>
                    )}
                    <button className="btn ghost sm" onClick={() => setView(c)}>كشف حساب</button>
                    {(c.balance || 0) > 0 && <button className="btn sm" onClick={() => setPayFor(c)}>{isCustomer ? 'تحصيل' : 'سداد'}</button>}
                    <button className="btn ghost sm" onClick={() => setForm({ ...c })}>تعديل</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <Modal title={form.id ? `تعديل: ${form.name}` : isCustomer ? 'عميل جديد' : 'مورد جديد'} onClose={() => setForm(null)}>
          <div className="field"><label>الاسم *</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></div>
          <div className="field"><label>الهاتف</label>
            <input className="input" inputMode="tel" value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div className="field"><label>العنوان</label>
            <input className="input" value={form.address || ''} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
          <button className="btn block" onClick={save} disabled={!form.name?.trim()}>💾 حفظ</button>
        </Modal>
      )}

      {view && <StatementModal party={view} kind={kind} onClose={() => setView(null)} />}

      {payFor && (
        <PaymentModal
          party={payFor} kind={kind} userName={user.name}
          onClose={() => setPayFor(null)}
        />
      )}
    </>
  );
}

function StatementModal({ party, kind, onClose }) {
  const isCustomer = kind === 'customer';
  const type = isCustomer ? 'sale' : 'purchase';
  const invoices = useLiveQuery(
    () => db.invoices.where('partyId').equals(party.id).and((i) => i.type === type).toArray(),
    [party.id], []
  );
  const payments = useLiveQuery(
    () => db.payments.where('partyId').equals(party.id).and((p) => p.partyType === kind).toArray(),
    [party.id], []
  );
  const rows = [
    ...invoices.map((i) => ({
      date: i.createdAt, label: `فاتورة ${i.number}${i.status === 'cancelled' ? ' (ملغاة)' : ''}`,
      debit: i.status === 'cancelled' ? 0 : i.remaining, total: i.total, credit: 0,
    })),
    ...payments.map((p) => ({ date: p.createdAt, label: `دفعة${p.note ? ` — ${p.note}` : ''}`, debit: 0, credit: p.amount })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  let running = 0;
  const withBal = rows.map((r) => { running += (r.debit || 0) - (r.credit || 0); return { ...r, balance: running }; });

  return (
    <Modal title={`كشف حساب: ${party.name}`} onClose={onClose}>
      <p className="muted">
        الهاتف: {party.phone || '—'} · الرصيد الحالي: <b style={{ color: (party.balance || 0) > 0 ? 'var(--red)' : 'var(--green)' }}>{money(party.balance)}</b>
        {isCustomer && party.points ? <> · ⭐ نقاط: <b>{party.points}</b></> : ''}
      </p>
      {withBal.length === 0 ? (
        <div className="empty">لا توجد حركة</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>البيان</th><th>آجل</th><th>دفعة</th><th>الرصيد</th><th>التاريخ</th></tr></thead>
            <tbody>
              {withBal.map((r, i) => (
                <tr key={i}>
                  <td>{r.label}</td>
                  <td className="num">{r.debit ? fmt(r.debit) : '—'}</td>
                  <td className="num" style={{ color: 'var(--green)' }}>{r.credit ? fmt(r.credit) : '—'}</td>
                  <td className="num">{fmt(r.balance)}</td>
                  <td className="muted">{fmtDate(r.date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function PaymentModal({ party, kind, userName, onClose }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const isCustomer = kind === 'customer';
  const save = async () => {
    await recordPayment({
      partyType: kind, partyId: party.id, partyName: party.name,
      amount: Number(amount), note, userName,
    });
    onClose();
  };
  return (
    <Modal title={`${isCustomer ? 'تحصيل من' : 'سداد إلى'}: ${party.name}`} onClose={onClose}>
      <p className="muted">الرصيد الحالي: <b>{money(party.balance)}</b>{isCustomer && party.points ? <> · ⭐ {party.points} نقطة</> : ''}</p>
      <div className="field"><label>المبلغ *</label>
        <input className="input lg" type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></div>
      <div className="field"><label>ملاحظة</label>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="نقدي / فودافون كاش..." /></div>
      <button className="btn block" onClick={save} disabled={!Number(amount)}>💾 تسجيل الدفعة</button>
    </Modal>
  );
}
