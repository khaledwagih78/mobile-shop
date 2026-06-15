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
  const [form, setForm] = useState(null);
  const [view, setView] = useState(null);
  const [payFor, setPayFor] = useState(null);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return list;
    return list.filter((c) => (c.name || '').toLowerCase().includes(t) || (c.phone || '').includes(t));
  }, [list, q]);

  const totalDebt = list.reduce((s, c) => s + Math.max(0, c.balance || 0), 0);

  const save = async () => {
    if (form.id) {
      await table.update(form.id, { name: form.name, phone: form.phone, address: form.address });
    } else {
      await table.add({ ...form, balance: 0, createdAt: nowISO() });
    }
    await queueSync(isCustomer ? 'customers' : 'suppliers', form.id ? 'update' : 'add', form);
    setForm(null);
  };

  return (
    <>
      <div className="page-head">
        <h1>{isCustomer ? '👥 العملاء' : '🚚 الموردين'} <span className="muted" style={{ fontSize: 14 }}>({list.length})</span></h1>
        <button className="btn" onClick={() => setForm({ name: '', phone: '', address: '' })}>＋ {isCustomer ? 'عميل' : 'مورد'} جديد</button>
      </div>

      <div className="kpis">
        <div className="kpi tone-red">
          <div className="label">{isCustomer ? 'إجمالي ديون العملاء (آجل)' : 'إجمالي المستحق للموردين'}</div>
          <div className="value">{money(totalDebt)}</div>
        </div>
      </div>

      <div className="list-tools">
        <input className="input" placeholder="بحث بالاسم أو الهاتف..." value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {filtered.length === 0 ? (
        <div className="card empty"><div className="big-ico">👥</div><p>لا يوجد {isCustomer ? 'عملاء' : 'موردين'}</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>الاسم</th><th>الهاتف</th><th>العنوان</th><th>الرصيد</th><th></th></tr></thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td><b>{c.name}</b></td>
                  <td className="num">{c.phone || '—'}</td>
                  <td className="muted">{c.address || '—'}</td>
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
      <p className="muted">الهاتف: {party.phone || '—'} · الرصيد الحالي: <b style={{ color: (party.balance || 0) > 0 ? 'var(--red)' : 'var(--green)' }}>{money(party.balance)}</b></p>
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
      <p className="muted">الرصيد الحالي: <b>{money(party.balance)}</b></p>
      <div className="field"><label>المبلغ *</label>
        <input className="input lg" type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></div>
      <div className="field"><label>ملاحظة</label>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="نقدي / فودافون كاش..." /></div>
      <button className="btn block" onClick={save} disabled={!Number(amount)}>💾 تسجيل الدفعة</button>
    </Modal>
  );
}
