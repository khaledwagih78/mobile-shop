import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, nowISO, queueSync } from '../db';
import { money, fmt } from '../utils';
import { Modal } from '../components/UI';

const EMPTY = { name: '', phone: '', jobTitle: '', hireDate: '', baseSalary: '', status: 'active' };

export default function Employees() {
  const nav = useNavigate();
  const employees = useLiveQuery(() => db.employees.orderBy('name').toArray(), [], []);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [form, setForm] = useState(null);

  const filtered = useMemo(() => {
    let list = statusFilter !== 'all' ? employees.filter((e) => e.status === statusFilter) : employees;
    const t = q.trim().toLowerCase();
    if (t) list = list.filter((e) =>
      (e.name || '').toLowerCase().includes(t) ||
      (e.phone || '').includes(t) ||
      (e.jobTitle || '').toLowerCase().includes(t)
    );
    return list;
  }, [employees, q, statusFilter]);

  const active = employees.filter((e) => e.status === 'active');
  const totalSalary = active.reduce((s, e) => s + (e.baseSalary || 0), 0);

  const save = async () => {
    const doc = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      jobTitle: form.jobTitle.trim(),
      hireDate: form.hireDate,
      baseSalary: Number(form.baseSalary) || 0,
      status: form.status,
    };
    if (form.id) {
      await db.employees.update(form.id, doc);
      await queueSync('employees', 'update', { ...doc, id: form.id });
    } else {
      const id = await db.employees.add({ ...doc, createdAt: nowISO() });
      await queueSync('employees', 'add', { ...doc, id });
    }
    setForm(null);
  };

  const remove = async (emp) => {
    if (!confirm(`حذف الموظف "${emp.name}"؟ سيتم حذف كل سجلاته أيضاً.`)) return;
    // Queue individual empRecord deletes so server removes them too
    const recs = await db.empRecords.where('employeeId').equals(emp.id).toArray();
    for (const r of recs) await queueSync('empRecords', 'delete', { id: r.id });
    await db.empRecords.where('employeeId').equals(emp.id).delete();
    await db.employees.delete(emp.id);
    await queueSync('employees', 'delete', { id: emp.id });
  };

  return (
    <>
      <div className="page-head">
        <h1>👷 الموظفين</h1>
        <button className="btn accent" onClick={() => setForm({ ...EMPTY })}>＋ موظف جديد</button>
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="label">الموظفون النشطون</div>
          <div className="value">{fmt(active.length)}</div>
          <div className="sub">{employees.length} إجمالي</div>
        </div>
        <div className="kpi tone-red">
          <div className="label">إجمالي الرواتب الشهرية</div>
          <div className="value">{money(totalSalary)}</div>
          <div className="sub">للموظفين النشطين</div>
        </div>
      </div>

      <div className="list-tools">
        <input
          className="input"
          placeholder="بحث بالاسم أو الهاتف أو الوظيفة..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="input"
          style={{ maxWidth: 160 }}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">الكل</option>
          <option value="active">نشط</option>
          <option value="inactive">موقوف</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="card empty">
          <div className="big-ico">👷</div>
          <p>لا يوجد موظفون{statusFilter !== 'all' ? ' بهذه الحالة' : ''}</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>الاسم</th>
                <th>الوظيفة</th>
                <th>الهاتف</th>
                <th>تاريخ التعيين</th>
                <th>المرتب الأساسي</th>
                <th>الحالة</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((emp) => (
                <tr key={emp.id} className="clickable" onClick={() => nav(`/employees/${emp.id}`)}>
                  <td><b>{emp.name}</b></td>
                  <td>{emp.jobTitle || '—'}</td>
                  <td className="num">{emp.phone || '—'}</td>
                  <td className="muted">{emp.hireDate || '—'}</td>
                  <td className="num">{money(emp.baseSalary)}</td>
                  <td>
                    {emp.status === 'active'
                      ? <span className="badge green">نشط</span>
                      : <span className="badge red">موقوف</span>}
                  </td>
                  <td style={{ display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
                    <button
                      className="btn ghost sm"
                      onClick={() => setForm({ ...emp, baseSalary: String(emp.baseSalary) })}
                    >تعديل</button>
                    <button className="btn danger sm" onClick={() => remove(emp)}>حذف</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ padding: '8px 14px' }}>{fmt(filtered.length)} موظف</p>
        </div>
      )}

      {form && (
        <Modal
          title={form.id ? `تعديل: ${form.name}` : 'موظف جديد'}
          onClose={() => setForm(null)}
        >
          <div className="row">
            <div className="field">
              <label>الاسم *</label>
              <input
                className="input"
                value={form.name}
                autoFocus
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="field">
              <label>الهاتف</label>
              <input
                className="input"
                inputMode="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>الوظيفة</label>
              <input
                className="input"
                value={form.jobTitle}
                placeholder="مثال: موظف مبيعات / سائق توزيع..."
                onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
              />
            </div>
            <div className="field">
              <label>تاريخ التعيين</label>
              <input
                className="input"
                type="date"
                value={form.hireDate}
                onChange={(e) => setForm({ ...form, hireDate: e.target.value })}
              />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>المرتب الأساسي (ج.م) *</label>
              <input
                className="input lg"
                type="number"
                min="0"
                value={form.baseSalary}
                placeholder="0"
                onChange={(e) => setForm({ ...form, baseSalary: e.target.value })}
              />
            </div>
            <div className="field">
              <label>الحالة</label>
              <select
                className="input"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                <option value="active">نشط</option>
                <option value="inactive">موقوف</option>
              </select>
            </div>
          </div>
          <button
            className="btn big block"
            onClick={save}
            disabled={!form.name.trim() || form.baseSalary === ''}
          >
            💾 {form.id ? 'حفظ التعديل' : 'إضافة الموظف'}
          </button>
        </Modal>
      )}
    </>
  );
}
