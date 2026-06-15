import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, nowISO, today, queueSync } from '../db';
import { money, fmt } from '../utils';
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

const REC_EMPTY = {
  name: '',
  category: EXPENSE_CATS[0],
  amount: '',
  dayOfMonth: '1',
  startDate: today().slice(0, 7) + '-01',
  endType: 'forever',
  maxOccurrences: '',
  endDate: '',
};

function monthsBetween(startYM, endYM) {
  const [sy, sm] = startYM.split('-').map(Number);
  const [ey, em] = endYM.split('-').map(Number);
  return Math.max(0, (ey - sy) * 12 + (em - sm) + 1);
}

function recProgressLabel(rec, postedCount) {
  if (rec.maxOccurrences) {
    const rem = rec.maxOccurrences - postedCount;
    return rem > 0
      ? `دُفع ${postedCount} من ${rec.maxOccurrences} — فاضل ${rem}`
      : `✓ اكتمل (${rec.maxOccurrences} مرة)`;
  }
  if (rec.endDate) {
    const total = monthsBetween(rec.startDate.slice(0, 7), rec.endDate.slice(0, 7));
    return `دُفع ${postedCount} من ${total}`;
  }
  return `دُفع ${postedCount} مرة`;
}

async function applyRecurring() {
  const recurrings = await db.recurringExpenses.filter((r) => r.status === 'active').toArray();
  if (!recurrings.length) return;

  const todayStr = today();
  const todayDay = Number(todayStr.slice(8, 10));
  const todayYM  = todayStr.slice(0, 7);
  const [ty, tm] = todayYM.split('-').map(Number);

  for (const rec of recurrings) {
    const posted = await db.expenses.where('recurringId').equals(rec.id).toArray();
    const postedMonths = new Set(posted.map((e) => e.day.slice(0, 7)));
    let postedCount = posted.length;

    let [sy, sm] = rec.startDate.split('-').map(Number);

    while (sy < ty || (sy === ty && sm <= tm)) {
      const ym = `${sy}-${String(sm).padStart(2, '0')}`;

      if (ym === todayYM && todayDay < rec.dayOfMonth) break;
      if (rec.endDate && ym > rec.endDate.slice(0, 7)) break;
      if (rec.maxOccurrences && postedCount >= rec.maxOccurrences) break;

      if (!postedMonths.has(ym)) {
        await db.expenses.add({
          day: `${ym}-${String(rec.dayOfMonth).padStart(2, '0')}`,
          category: rec.category,
          description: rec.name,
          amount: rec.amount,
          userName: 'تلقائي',
          recurringId: rec.id,
          createdAt: nowISO(),
        });
        postedCount++;
      }

      sm++;
      if (sm > 12) { sm = 1; sy++; }
    }

    const done =
      (rec.maxOccurrences && postedCount >= rec.maxOccurrences) ||
      (rec.endDate && todayYM > rec.endDate.slice(0, 7));
    if (done) await db.recurringExpenses.update(rec.id, { status: 'completed' });
  }
}

const STATUS_LABEL = { active: 'نشط', paused: 'موقوف', completed: 'مكتمل' };
const STATUS_COLOR = { active: 'green', paused: 'amber', completed: 'gray' };

export default function Expenses() {
  const { user } = useAuth();
  const [tab, setTab]             = useState('list');
  const [catFilter, setCatFilter] = useState('all');
  const [from, setFrom]           = useState(today().slice(0, 7) + '-01');
  const [to, setTo]               = useState(today());
  const [form, setForm]           = useState(null);
  const [recForm, setRecForm]     = useState(null);

  const expenses   = useLiveQuery(() => db.expenses.orderBy('createdAt').reverse().toArray(), [], []);
  const recurrings = useLiveQuery(() => db.recurringExpenses.orderBy('createdAt').toArray(), [], []);

  useEffect(() => { applyRecurring(); }, []);

  const t          = today();
  const monthStart = t.slice(0, 7) + '-01';
  const yearStart  = t.slice(0, 4) + '-01-01';

  const totDay   = useMemo(() => expenses.filter((e) => e.day === t).reduce((s, e) => s + e.amount, 0), [expenses, t]);
  const totMonth = useMemo(() => expenses.filter((e) => e.day >= monthStart).reduce((s, e) => s + e.amount, 0), [expenses, monthStart]);
  const totYear  = useMemo(() => expenses.filter((e) => e.day >= yearStart).reduce((s, e) => s + e.amount, 0), [expenses, yearStart]);

  const filtered = useMemo(() => {
    let list = expenses.filter((e) => e.day >= from && e.day <= to);
    if (catFilter !== 'all') list = list.filter((e) => e.category === catFilter);
    return list;
  }, [expenses, from, to, catFilter]);

  const byCat = useMemo(() => {
    const map = {};
    for (const cat of EXPENSE_CATS) map[cat] = 0;
    for (const e of filtered) {
      const key = EXPENSE_CATS.includes(e.category) ? e.category : 'مصاريف تشغيل';
      map[key] = (map[key] || 0) + e.amount;
    }
    return Object.entries(map).map(([cat, total]) => ({ cat, total })).sort((a, b) => b.total - a.total);
  }, [filtered]);

  const filteredTotal = filtered.reduce((s, e) => s + e.amount, 0);

  const postedCountById = useMemo(() => {
    const map = {};
    for (const e of expenses) {
      if (e.recurringId) map[e.recurringId] = (map[e.recurringId] || 0) + 1;
    }
    return map;
  }, [expenses]);

  const activeRecurrings    = recurrings.filter((r) => r.status === 'active');
  const activeRecMonthly    = activeRecurrings.reduce((s, r) => s + r.amount, 0);

  // ---- CRUD: regular expenses ----
  const openAdd  = () => setForm({ ...EMPTY_FORM });
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

  // ---- CRUD: recurring templates ----
  const openAddRec = () => setRecForm({ ...REC_EMPTY, startDate: today().slice(0, 7) + '-01' });

  const openEditRec = (rec) => setRecForm({
    ...rec,
    amount:         String(rec.amount),
    dayOfMonth:     String(rec.dayOfMonth),
    endType:        rec.maxOccurrences ? 'count' : rec.endDate ? 'date' : 'forever',
    maxOccurrences: rec.maxOccurrences ? String(rec.maxOccurrences) : '',
    endDate:        rec.endDate || '',
  });

  const saveRec = async () => {
    const doc = {
      name:           recForm.name.trim(),
      category:       recForm.category,
      amount:         Number(recForm.amount),
      dayOfMonth:     Math.min(28, Math.max(1, Number(recForm.dayOfMonth))),
      startDate:      recForm.startDate,
      endDate:        recForm.endType === 'date'  ? recForm.endDate        : null,
      maxOccurrences: recForm.endType === 'count' ? Number(recForm.maxOccurrences) : null,
      status:         'active',
    };
    if (recForm.id) {
      await db.recurringExpenses.update(recForm.id, doc);
      await queueSync('recurringExpenses', 'update', { ...doc, id: recForm.id });
    } else {
      const id = await db.recurringExpenses.add({ ...doc, createdAt: nowISO() });
      await queueSync('recurringExpenses', 'add', { ...doc, id });
      setTimeout(applyRecurring, 200);
    }
    setRecForm(null);
  };

  const toggleRec = async (rec) => {
    const next = rec.status === 'active' ? 'paused' : 'active';
    await db.recurringExpenses.update(rec.id, { status: next });
    await queueSync('recurringExpenses', 'update', { ...rec, status: next });
    if (next === 'active') setTimeout(applyRecurring, 200);
  };

  const removeRec = async (rec) => {
    if (!confirm(`حذف "${rec.name}"؟ السجلات المدفوعة مسبقاً ستبقى كما هي.`)) return;
    await db.recurringExpenses.delete(rec.id);
    await queueSync('recurringExpenses', 'delete', { id: rec.id });
  };

  const canSave = form && form.day && Number(form.amount) > 0;

  const canSaveRec = recForm &&
    recForm.name.trim() &&
    Number(recForm.amount) > 0 &&
    recForm.startDate &&
    Number(recForm.dayOfMonth) >= 1 && Number(recForm.dayOfMonth) <= 28 &&
    (recForm.endType !== 'count' || Number(recForm.maxOccurrences) > 0) &&
    (recForm.endType !== 'date'  || recForm.endDate);

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
        {activeRecMonthly > 0 && (
          <div className="kpi">
            <div className="label">🔁 متكررة شهرياً</div>
            <div className="value">{money(activeRecMonthly)}</div>
            <div className="sub">{activeRecurrings.length} بند نشط</div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="list-tools" style={{ marginBottom: 0 }}>
        <button className={`btn ${tab === 'list'      ? '' : 'ghost'}`} onClick={() => setTab('list')}>📋 السجل</button>
        <button className={`btn ${tab === 'cats'      ? '' : 'ghost'}`} onClick={() => setTab('cats')}>📊 حسب الفئة</button>
        <button className={`btn ${tab === 'recurring' ? '' : 'ghost'}`} onClick={() => setTab('recurring')}>🔁 المتكررة</button>
      </div>

      {/* Filters — list + cats only */}
      {tab !== 'recurring' && (
        <div className="list-tools">
          <select className="input" style={{ maxWidth: 190 }} value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
            <option value="all">كل الفئات</option>
            {EXPENSE_CATS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input className="input" style={{ maxWidth: 160 }} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input className="input" style={{ maxWidth: 160 }} type="date" value={to}   onChange={(e) => setTo(e.target.value)} />
          <span className="muted" style={{ alignSelf: 'center', fontSize: 13 }}>
            الإجمالي: <b style={{ color: 'var(--red)' }}>{money(filteredTotal)}</b>
          </span>
        </div>
      )}

      {/* ── List tab ── */}
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
                <tr><th>التاريخ</th><th>الفئة</th><th>الوصف</th><th>المبلغ</th><th>بواسطة</th><th></th></tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id}>
                    <td className="muted">{e.day}</td>
                    <td>
                      <span className="badge gray">{e.category || 'غير محدد'}</span>
                      {e.recurringId && <span title="مصروف تلقائي متكرر" style={{ marginRight: 4 }}>🔁</span>}
                    </td>
                    <td>{e.description || '—'}</td>
                    <td className="num" style={{ color: 'var(--red)', fontWeight: 700 }}>{money(e.amount)}</td>
                    <td className="muted">{e.userName}</td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      {!e.recurringId && (
                        <button className="btn ghost sm" onClick={() => openEdit(e)}>تعديل</button>
                      )}
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

      {/* ── Category tab ── */}
      {tab === 'cats' && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>الفئة</th><th>الإجمالي</th><th>النسبة</th></tr></thead>
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

      {/* ── Recurring tab ── */}
      {tab === 'recurring' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '12px 0' }}>
            <button className="btn accent" onClick={openAddRec}>＋ مصروف متكرر جديد</button>
          </div>

          {recurrings.length === 0 ? (
            <div className="card empty">
              <div className="big-ico">🔁</div>
              <p>لا توجد مصاريف متكررة — أضف إيجار أو قسط أو جمعية</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>الاسم</th>
                    <th>الفئة</th>
                    <th>المبلغ/شهر</th>
                    <th>يوم التخصيم</th>
                    <th>التقدم</th>
                    <th>الحالة</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {recurrings.map((rec) => {
                    const cnt = postedCountById[rec.id] || 0;
                    return (
                      <tr key={rec.id}>
                        <td><b>{rec.name}</b></td>
                        <td><span className="badge gray">{rec.category}</span></td>
                        <td className="num" style={{ fontWeight: 700, color: 'var(--red)' }}>{money(rec.amount)}</td>
                        <td className="muted">كل يوم {rec.dayOfMonth}</td>
                        <td className="muted" style={{ fontSize: 12 }}>{recProgressLabel(rec, cnt)}</td>
                        <td>
                          <span className={`badge ${STATUS_COLOR[rec.status] || 'gray'}`}>
                            {STATUS_LABEL[rec.status] || rec.status}
                          </span>
                        </td>
                        <td style={{ display: 'flex', gap: 6 }}>
                          {rec.status !== 'completed' && (
                            <button className="btn ghost sm" onClick={() => toggleRec(rec)}>
                              {rec.status === 'active' ? 'إيقاف' : 'تفعيل'}
                            </button>
                          )}
                          <button className="btn ghost sm" onClick={() => openEditRec(rec)}>تعديل</button>
                          <button className="btn danger sm" onClick={() => removeRec(rec)}>حذف</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {activeRecMonthly > 0 && (
                <p className="muted" style={{ padding: '8px 14px' }}>
                  إجمالي الالتزامات الشهرية النشطة: <b style={{ color: 'var(--red)' }}>{money(activeRecMonthly)}</b>
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Add/Edit regular expense modal ── */}
      {form && (
        <Modal title={form.id ? 'تعديل مصروف' : 'مصروف جديد'} onClose={() => setForm(null)}>
          <div className="row">
            <div className="field">
              <label>التاريخ *</label>
              <input className="input" type="date" value={form.day}
                onChange={(e) => setForm({ ...form, day: e.target.value })} />
            </div>
            <div className="field">
              <label>الفئة *</label>
              <select className="input" value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {EXPENSE_CATS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="field">
            <label>الوصف</label>
            <input className="input" value={form.description} autoFocus
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="مثال: إيجار المحل شهر يونيو / راتب موظف التوصيل..." />
          </div>
          <div className="field">
            <label>المبلغ (ج.م) *</label>
            <input className="input lg" type="number" min="0" step="0.01" value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0" />
          </div>
          <button className="btn big block" onClick={save} disabled={!canSave}>
            💾 {form.id ? 'حفظ التعديل' : 'إضافة المصروف'}
          </button>
        </Modal>
      )}

      {/* ── Add/Edit recurring expense modal ── */}
      {recForm && (
        <Modal title={recForm.id ? 'تعديل المصروف المتكرر' : 'مصروف متكرر جديد'} onClose={() => setRecForm(null)}>
          <div className="field">
            <label>الاسم / البند *</label>
            <input className="input" value={recForm.name} autoFocus
              onChange={(e) => setRecForm({ ...recForm, name: e.target.value })}
              placeholder="مثال: إيجار المحل / قسط السيارة / جمعية الموظفين" />
          </div>
          <div className="row">
            <div className="field">
              <label>الفئة</label>
              <select className="input" value={recForm.category}
                onChange={(e) => setRecForm({ ...recForm, category: e.target.value })}>
                {EXPENSE_CATS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="field">
              <label>المبلغ الشهري (ج.م) *</label>
              <input className="input lg" type="number" min="0" step="0.01" value={recForm.amount}
                onChange={(e) => setRecForm({ ...recForm, amount: e.target.value })} placeholder="0" />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>يوم التخصيم (1–28) *</label>
              <input className="input" type="number" min="1" max="28" value={recForm.dayOfMonth}
                onChange={(e) => setRecForm({ ...recForm, dayOfMonth: e.target.value })} />
            </div>
            <div className="field">
              <label>تاريخ البداية *</label>
              <input className="input" type="date" value={recForm.startDate}
                onChange={(e) => setRecForm({ ...recForm, startDate: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label>متى ينتهي؟</label>
            <select className="input" value={recForm.endType}
              onChange={(e) => setRecForm({ ...recForm, endType: e.target.value })}>
              <option value="forever">مؤبد — لا ينتهي (إيجار مستمر...)</option>
              <option value="count">عدد محدد من المرات (قسط / جمعية)</option>
              <option value="date">حتى تاريخ معين</option>
            </select>
          </div>
          {recForm.endType === 'count' && (
            <div className="field">
              <label>عدد مرات التكرار *</label>
              <input className="input" type="number" min="1" value={recForm.maxOccurrences}
                onChange={(e) => setRecForm({ ...recForm, maxOccurrences: e.target.value })}
                placeholder="مثال: 12 للسنة، 10 لجمعية..." />
            </div>
          )}
          {recForm.endType === 'date' && (
            <div className="field">
              <label>تاريخ الانتهاء *</label>
              <input className="input" type="date" value={recForm.endDate}
                onChange={(e) => setRecForm({ ...recForm, endDate: e.target.value })} />
            </div>
          )}
          <button className="btn big block" onClick={saveRec} disabled={!canSaveRec}>
            💾 {recForm.id ? 'حفظ التعديل' : 'إضافة المصروف المتكرر'}
          </button>
        </Modal>
      )}
    </>
  );
}
