import { useMemo, useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, today, getSetting, setSetting, addRepVisit } from '../db';
import { money, fmt, fmtDate } from '../utils';
import { Modal, Toast } from '../components/UI';
import { useAuth } from '../auth';

const PURPOSES = { visit: 'زيارة', sale: 'بيع', collection: 'تحصيل', followup: 'متابعة' };

export default function Reps() {
  const { user, activeBranch } = useAuth();
  const employees = useLiveQuery(() => db.employees.toArray(), [], []);
  const customers = useLiveQuery(() => db.customers.toArray(), [], []);
  const visits = useLiveQuery(() => db.repVisits.orderBy('createdAt').reverse().toArray(), [], []);
  const [month, setMonth] = useState(today().slice(0, 7));
  const [repFilter, setRepFilter] = useState('all');
  const [form, setForm] = useState(null);
  const [targets, setTargets] = useState({});
  const [toast, setToast] = useState('');
  const notify = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  useEffect(() => { (async () => setTargets(await getSetting('repTargets', {}) || {}))(); }, []);

  const reps = useMemo(() => {
    const set = new Set([...employees.map((e) => e.name), ...visits.map((v) => v.repName)].filter(Boolean));
    return [...set];
  }, [employees, visits]);

  const monthVisits = useMemo(() => visits.filter((v) => (v.day || '').slice(0, 7) === month && (repFilter === 'all' || v.repName === repFilter)), [visits, month, repFilter]);

  const perRep = useMemo(() => {
    const m = {};
    for (const v of visits) {
      if ((v.day || '').slice(0, 7) !== month) continue;
      const r = (m[v.repName] ||= { visits: 0, orders: 0, collected: 0 });
      r.visits++; r.orders += Number(v.orderAmount) || 0; r.collected += Number(v.collectedAmount) || 0;
    }
    return Object.entries(m).map(([name, s]) => ({ name, ...s, target: Number(targets[name]) || 0 }))
      .sort((a, b) => b.orders - a.orders);
  }, [visits, month, targets]);

  const saveTarget = async (name, value) => {
    const next = { ...targets, [name]: Number(value) || 0 };
    setTargets(next);
    await setSetting('repTargets', next);
  };

  const save = async () => {
    await addRepVisit({
      repName: form.repName, customerId: form.customerId ? Number(form.customerId) : null,
      customerName: customers.find((c) => c.id === Number(form.customerId))?.name || '',
      date: form.date, purpose: form.purpose, result: form.result,
      orderAmount: Number(form.orderAmount) || 0, collectedAmount: Number(form.collectedAmount) || 0,
      notes: form.notes, recordCollection: form.recordCollection, branchId: activeBranch,
    });
    notify('✅ تم تسجيل الزيارة');
    setForm(null);
  };

  return (
    <>
      <div className="page-head">
        <h1>🚶 المندوبون</h1>
        <button className="btn accent" onClick={() => setForm({ repName: reps[0] || '', customerId: '', date: today(), purpose: 'visit', result: '', orderAmount: '', collectedAmount: '', notes: '', recordCollection: true })}>＋ تسجيل زيارة</button>
      </div>

      <div className="list-tools">
        <input className="input" style={{ maxWidth: 160 }} type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        <select className="input" style={{ maxWidth: 180 }} value={repFilter} onChange={(e) => setRepFilter(e.target.value)}>
          <option value="all">كل المندوبين</option>
          {reps.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {perRep.length > 0 && (
        <div className="table-wrap" style={{ marginBottom: 14 }}>
          <table>
            <thead><tr><th>المندوب</th><th>زيارات</th><th>مبيعات</th><th>تحصيل</th><th>الهدف الشهري</th><th>الإنجاز</th></tr></thead>
            <tbody>
              {perRep.map((r) => {
                const pct = r.target > 0 ? Math.round((r.orders / r.target) * 100) : 0;
                return (
                  <tr key={r.name}>
                    <td><b>{r.name}</b></td>
                    <td className="num">{fmt(r.visits)}</td>
                    <td className="num" style={{ color: 'var(--green)' }}>{money(r.orders)}</td>
                    <td className="num">{money(r.collected)}</td>
                    <td style={{ maxWidth: 120 }}>
                      <input className="input" type="number" min="0" value={targets[r.name] ?? ''} placeholder="0"
                        onChange={(e) => saveTarget(r.name, e.target.value)} />
                    </td>
                    <td>{r.target > 0 ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ height: 8, borderRadius: 4, background: pct >= 100 ? 'var(--green)' : 'var(--accent, #0F4C5C)', width: Math.min(100, pct) + '%', minWidth: 4, maxWidth: 120 }} />
                        <span className="muted" style={{ fontSize: 12 }}>{pct}%</span>
                      </div>
                    ) : <span className="muted">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {monthVisits.length === 0 ? (
        <div className="card empty"><div className="big-ico">🚶</div><p>لا توجد زيارات في هذا الشهر</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>التاريخ</th><th>المندوب</th><th>العميل</th><th>الغرض</th><th>مبيعات</th><th>تحصيل</th><th>النتيجة</th></tr></thead>
            <tbody>
              {monthVisits.map((v) => (
                <tr key={v.id}>
                  <td className="muted">{v.day}</td>
                  <td>{v.repName}</td>
                  <td>{v.customerName || '—'}</td>
                  <td><span className="badge gray">{PURPOSES[v.purpose] || v.purpose}</span></td>
                  <td className="num">{v.orderAmount ? money(v.orderAmount) : '—'}</td>
                  <td className="num">{v.collectedAmount ? money(v.collectedAmount) : '—'}</td>
                  <td className="muted">{v.result || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <Modal title="تسجيل زيارة مندوب" onClose={() => setForm(null)}>
          <div className="row">
            <div className="field"><label>المندوب *</label>
              <select className="input" value={form.repName} onChange={(e) => setForm({ ...form, repName: e.target.value })}>
                <option value="">—</option>
                {employees.map((e) => <option key={e.id} value={e.name}>{e.name}</option>)}
              </select></div>
            <div className="field"><label>التاريخ</label>
              <input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
          </div>
          <div className="row">
            <div className="field"><label>العميل</label>
              <select className="input" value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}>
                <option value="">—</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{(c.balance || 0) > 0 ? ` — عليه ${fmt(c.balance)}` : ''}</option>)}
              </select></div>
            <div className="field"><label>الغرض</label>
              <select className="input" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })}>
                {Object.entries(PURPOSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
          </div>
          <div className="row">
            <div className="field"><label>قيمة الأوردر (إن وجد)</label>
              <input className="input" type="number" min="0" value={form.orderAmount} onChange={(e) => setForm({ ...form, orderAmount: e.target.value })} placeholder="0" /></div>
            <div className="field"><label>مبلغ التحصيل</label>
              <input className="input" type="number" min="0" value={form.collectedAmount} onChange={(e) => setForm({ ...form, collectedAmount: e.target.value })} placeholder="0" /></div>
          </div>
          {Number(form.collectedAmount) > 0 && form.customerId && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', margin: '4px 0' }}>
              <input type="checkbox" checked={form.recordCollection} onChange={(e) => setForm({ ...form, recordCollection: e.target.checked })} />
              تسجيل التحصيل كدفعة على حساب العميل (تخصم من رصيده وتدخل المحاسبة)
            </label>
          )}
          <div className="field"><label>النتيجة / ملاحظات</label>
            <input className="input" value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value })} placeholder="مثال: اتفقنا على أوردر الأسبوع الجاي" /></div>
          <button className="btn accent block" onClick={save} disabled={!form.repName}>💾 حفظ الزيارة</button>
        </Modal>
      )}

      <Toast msg={toast} />
    </>
  );
}
