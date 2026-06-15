import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, nowISO, dayOf, today, queueSync } from '../db';
import { money, fmt, fmtDate } from '../utils';
import { Modal } from '../components/UI';
import { useAuth } from '../auth';

export const EXPENSE_CATS = [
  'إيجار',
  'رواتب',
  'سيارات وتوزيع',
  'صيانة',
  'مشتريات',
  'مصاريف تشغيل',
];

const EMPTY_FORM = { day: today(), category: EXPENSE_CATS[0], description: '', amount: '' };

export default function Expenses() {
  const { user } = useAuth();
  const [tab, setTab] = useState('list');
  const [catFilter, setCatFilter] = useState('all');
  const [from, setFrom] = useState(today().slice(0, 7) + '-01');
  const [to, setTo] = useState(today());
  const [form, setForm] = useState(null);

  const expenses = useLiveQuery(
    () => db.expenses.orderBy('createdAt').reverse().toArray(),
    [], []
  );

  // ---- KPI periods ----
  const t = today();
  const monthStart = t.slice(0, 7) + '-01';
  const yearStart  = t.slice(0, 4) + '-01-01';

  const totDay   = useMemo(() => expenses.filter((e) => e.day === t).reduce((s, e) => s + e.amount, 0), [expenses, t]);
  const totMonth = useMemo(() => expenses.filter((e) => e.day >= monthStart).reduce((s, e) => s + e.amount, 0), [expenses, monthStart]);
  const totYear  = useMemo(() => expenses.filter((e) => e.day >= yearStart).reduce((s, e) => s + e.amount, 0), [expenses, yearStart]);

  // ---- filtered list ----
  const filtered = useMemo(() => {
    let list = expenses.filter((e) => e.day >= from && e.day <= to);
    if (catFilter !== 'all') list = list.filter((e) => e.category === catFilter);
    return list;
  }, [expenses, from, to, catFilter]);

  // ---- by-category summary ----
  const byCat = useMemo(() => {
    const map = {};
    for (const cat of EXPENSE_CATS) map[cat] = 0;
    for (const e of filtered) {
      const key = EXPENSE_CATS.includes(e.category) ? e.category : 'مصاريف تشغيل';
      map[key] = (map[key] || 0) + e.amount;
    }
    return Object.entries(map)
      .map(([cat, total]) => ({ cat, total }))
      .sort((a, b) => b.total - a.total);
  }, [filtered]);

  const filteredTotal = filtered.reduce((s, e) => s + e.amount, 0);

  // ---- CRUD ----
  const openAdd = () => setForm({ ...EMPTY_FORM });
  const openEdit = (e) => setForm({ ...e, amount: String(e.amount) });

  const save = async () => {
    const doc = {
      day: form.day,
      category: form.category,
      description: form.description.trim(),
      amount: Number(form.amount),
      userName: user.name,
      createdAt: form.createdAt || nowISO(),
    };
    if (form.id) {
      await db.expenses.update(form.id, doc);
      await queueSync('expenses', 'update', { ...doc, id: form.id });
    } else {
      doc.createdAt = nowISO();
      const id = await db.expenses.add(doc);
      await queueSync('expenses', 'add', { ...doc, id });
    }
    setForm(null);
  };

  const remove = async (e) => {
    if (!confirm(`حذف المصروف "${e.description || e.category}" بمبلغ ${money(e.amount)}؟`)) return;
    await db.expenses.delete(e.id);
    await queueSync('expenses', 'delete', { id: e.id });
  };

  const canSave = form && form.day && Number(form.amount) > 0;

  return (
    <>
      <div className="page-head">
        <h1>💸 المصروفات</h1>
        <button className="btn accent" onClick={openAdd}>＋ مصروف جديد</button>
      </div>

      {/* KPIs */}
      <div className="kpis">
        <div className="kpi tone-red">
          <div className="label">مصاريف اليوم</div>
          <div className="value">{money(totDay)}</div>
        </div>
        <div className="kpi tone-red">
          <div className="label">مصاريف الشهر</div>
          <div className="value">{money(totMonth)}</div>
        </div>
        <div className="kpi tone-red">
          <div className="label">مصاريف السنة</div>
          <div className="value">{money(totYear)}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="list-tools" style={{ marginBottom: 0 }}>
        <button
          className={`btn ${tab === 'list' ? '' : 'ghost'}`}
          onClick={() => setTab('list')}
        >📋 السجل</button>
        <button
          className={`btn ${tab === 'cats' ? '' : 'ghost'}`}
          onClick={() => setTab('cats')}
        >📊 حسب الفئة</button>
      </div>

      {/* Filters */}
      <div className="list-tools">
        <select
          className="input"
          style={{ maxWidth: 190 }}
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
        >
          <option value="all">كل الفئات</option>
          {EXPENSE_CATS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input className="input" style={{ maxWidth: 160 }} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input className="input" style={{ maxWidth: 160 }} type="date" value={to}   onChange={(e) => setTo(e.target.value)} />
        <span className="muted" style={{ alignSelf: 'center', fontSize: 13 }}>
          الإجمالي: <b style={{ color: 'var(--red)' }}>{money(filteredTotal)}</b>
        </span>
      </div>

      {/* List tab */}
      {tab === 'list' && (
        filtered.length === 0 ? (
          <div className="card empty">
            <div className="big-ico">💸</div>
            <p>لا توجد مصروفات في هذه الفترة</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>الفئة</th>
                  <th>الوصف</th>
                  <th>المبلغ</th>
                  <th>بواسطة</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id}>
                    <td className="muted">{e.day}</td>
                    <td><span className="badge gray">{e.category || 'غير محدد'}</span></td>
                    <td>{e.description || '—'}</td>
                    <td className="num" style={{ color: 'var(--red)', fontWeight: 700 }}>{money(e.amount)}</td>
                    <td className="muted">{e.userName}</td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      <button className="btn ghost sm" onClick={() => openEdit(e)}>تعديل</button>
                      <button className="btn danger sm" onClick={() => remove(e)}>حذف</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted" style={{ padding: '8px 14px' }}>
              {fmt(filtered.length)} مصروف — الإجمالي {money(filteredTotal)}
            </p>
          </div>
        )
      )}

      {/* Category summary tab */}
      {tab === 'cats' && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>الفئة</th><th>الإجمالي</th><th>النسبة</th></tr>
            </thead>
            <tbody>
              {byCat.map(({ cat, total }) => (
                <tr key={cat}>
                  <td><b>{cat}</b></td>
                  <td className="num" style={{ color: total > 0 ? 'var(--red)' : 'var(--muted)', fontWeight: 700 }}>
                    {money(total)}
                  </td>
                  <td>
                    {filteredTotal > 0 && total > 0 ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{
                          height: 8, borderRadius: 4, background: 'var(--red)',
                          width: `${Math.round((total / filteredTotal) * 100)}%`,
                          minWidth: 4, maxWidth: 160,
                        }} />
                        <span className="muted" style={{ fontSize: 12 }}>
                          {Math.round((total / filteredTotal) * 100)}%
                        </span>
                      </div>
                    ) : <span className="muted">—</span>}
                  </td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--line)', fontWeight: 800 }}>
                <td>الإجمالي</td>
                <td className="num" style={{ color: 'var(--red)' }}>{money(filteredTotal)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Add / Edit modal */}
      {form && (
        <Modal
          title={form.id ? 'تعديل مصروف' : 'مصروف جديد'}
          onClose={() => setForm(null)}
        >
          <div className="row">
            <div className="field">
              <label>التاريخ *</label>
              <input
                className="input"
                type="date"
                value={form.day}
                onChange={(e) => setForm({ ...form, day: e.target.value })}
              />
            </div>
            <div className="field">
              <label>الفئة *</label>
              <select
                className="input"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              >
                {EXPENSE_CATS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="field">
            <label>الوصف</label>
            <input
              className="input"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="مثال: إيجار المحل شهر يونيو / راتب موظف التوصيل..."
              autoFocus
            />
          </div>
          <div className="field">
            <label>المبلغ (ج.م) *</label>
            <input
              className="input lg"
              type="number"
              min="0"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="0"
            />
          </div>
          <button className="btn big block" onClick={save} disabled={!canSave}>
            💾 {form.id ? 'حفظ التعديل' : 'إضافة المصروف'}
          </button>
        </Modal>
      )}
    </>
  );
}
