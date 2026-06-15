import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, nowISO, today } from '../db';
import { money, fmt, monthOf } from '../utils';
import { Modal } from '../components/UI';

const FIN_TYPES = {
  bonus:     { label: 'حافز',   color: 'green' },
  deduction: { label: 'خصم',    color: 'red'   },
  advance:   { label: 'سلفة',   color: 'amber' },
};

const LEAVE_TYPES = {
  annual:  'سنوية',
  sick:    'مرضية',
  unpaid:  'بدون راتب',
  other:   'أخرى',
};

const ATT_STATUS = {
  present: { label: 'حاضر',   color: 'green' },
  absent:  { label: 'غائب',   color: 'red'   },
  late:    { label: 'متأخر',  color: 'amber' },
};

function serviceDuration(hireDate) {
  if (!hireDate) return '—';
  const ms = Date.now() - new Date(hireDate).getTime();
  const totalMonths = Math.floor(ms / (30.44 * 24 * 3600 * 1000));
  const years  = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  if (years > 0) return `${years} سنة${months > 0 ? ` و${months} شهر` : ''}`;
  return `${months} شهر`;
}

export default function EmployeeDetail() {
  const { id } = useParams();
  const nav    = useNavigate();
  const empId  = Number(id);

  const [month,   setMonth]   = useState(monthOf(today()));
  const [tab,     setTab]     = useState('financial');
  const [form,    setForm]    = useState(null);   // add-record modal
  const [editEmp, setEditEmp] = useState(null);   // edit-employee modal

  const emp = useLiveQuery(() => db.employees.get(empId), [empId]);

  const allRecords = useLiveQuery(
    () => db.empRecords.where('employeeId').equals(empId).sortBy('day'),
    [empId], []
  );

  const monthRecords    = useMemo(() => allRecords.filter((r) => monthOf(r.day) === month), [allRecords, month]);
  const financialRecs   = useMemo(() => monthRecords.filter((r) => r.type in FIN_TYPES), [monthRecords]);
  const leaveRecs       = useMemo(() => monthRecords.filter((r) => r.type === 'leave'), [monthRecords]);
  const attendanceRecs  = useMemo(() => monthRecords.filter((r) => r.type === 'attendance'), [monthRecords]);

  const totBonus     = useMemo(() => financialRecs.filter((r) => r.type === 'bonus').reduce((s, r) => s + r.amount, 0), [financialRecs]);
  const totDeduction = useMemo(() => financialRecs.filter((r) => r.type === 'deduction').reduce((s, r) => s + r.amount, 0), [financialRecs]);
  const totAdvance   = useMemo(() => financialRecs.filter((r) => r.type === 'advance').reduce((s, r) => s + r.amount, 0), [financialRecs]);
  const netSalary    = (emp?.baseSalary || 0) + totBonus - totDeduction - totAdvance;

  // ---- save a new record ----
  const saveRecord = async () => {
    const base = { employeeId: empId, type: form.type, day: form.day, note: form.note || '', createdAt: nowISO() };
    if (form.type in FIN_TYPES) {
      await db.empRecords.add({ ...base, amount: Number(form.amount) || 0 });
    } else if (form.type === 'leave') {
      await db.empRecords.add({ ...base, leaveType: form.leaveType, days: Number(form.days) || 1, amount: 0 });
    } else {
      await db.empRecords.add({ ...base, attendanceStatus: form.attendanceStatus, amount: 0 });
    }
    setForm(null);
  };

  const removeRecord = async (rec) => {
    if (!confirm('حذف هذا السجل؟')) return;
    await db.empRecords.delete(rec.id);
  };

  // ---- save employee edits ----
  const saveEmp = async () => {
    await db.employees.update(empId, {
      name:       editEmp.name.trim(),
      phone:      editEmp.phone,
      jobTitle:   editEmp.jobTitle,
      hireDate:   editEmp.hireDate,
      baseSalary: Number(editEmp.baseSalary) || 0,
      status:     editEmp.status,
    });
    setEditEmp(null);
  };

  // ---- helpers ----
  const openFinancial  = () => setForm({ type: 'bonus',      day: today(), amount: '', note: '' });
  const openLeave      = () => setForm({ type: 'leave',      day: today(), leaveType: 'annual', days: '1', note: '' });
  const openAttendance = () => setForm({ type: 'attendance', day: today(), attendanceStatus: 'present', note: '' });

  const canSaveRecord =
    form && form.day && (
      (form.type in FIN_TYPES     && Number(form.amount) > 0) ||
      (form.type === 'leave'      && Number(form.days) > 0)   ||
      (form.type === 'attendance')
    );

  if (emp === undefined) return <div className="card empty">جاري التحميل...</div>;
  if (!emp)              return <div className="card empty">الموظف غير موجود</div>;

  return (
    <>
      {/* ---- Header ---- */}
      <div className="page-head">
        <div>
          <button className="btn ghost sm" style={{ marginBottom: 8 }} onClick={() => nav('/employees')}>
            ← قائمة الموظفين
          </button>
          <h1>👷 {emp.name}</h1>
        </div>
        <button className="btn ghost" onClick={() => setEditEmp({ ...emp, baseSalary: String(emp.baseSalary) })}>
          ✏️ تعديل البيانات
        </button>
      </div>

      {/* ---- Info card ---- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
          <div><span className="muted" style={{ fontSize: 12 }}>الوظيفة</span><br /><b>{emp.jobTitle || '—'}</b></div>
          <div><span className="muted" style={{ fontSize: 12 }}>الهاتف</span><br /><b>{emp.phone || '—'}</b></div>
          <div><span className="muted" style={{ fontSize: 12 }}>تاريخ التعيين</span><br /><b>{emp.hireDate || '—'}</b></div>
          <div><span className="muted" style={{ fontSize: 12 }}>مدة الخدمة</span><br /><b>{serviceDuration(emp.hireDate)}</b></div>
          <div>
            <span className="muted" style={{ fontSize: 12 }}>الحالة</span><br />
            <span className={`badge ${emp.status === 'active' ? 'green' : 'red'}`}>
              {emp.status === 'active' ? 'نشط' : 'موقوف'}
            </span>
          </div>
        </div>
      </div>

      {/* ---- Month filter + Net salary card ---- */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 16 }}>
        <div className="field" style={{ margin: 0, minWidth: 160 }}>
          <label>الشهر</label>
          <input
            className="input"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </div>
        <div className="kpis" style={{ flex: 1 }}>
          <div className="kpi">
            <div className="label">المرتب الأساسي</div>
            <div className="value">{money(emp.baseSalary)}</div>
          </div>
          <div className="kpi tone-green">
            <div className="label">الحوافز</div>
            <div className="value">＋ {money(totBonus)}</div>
          </div>
          <div className="kpi tone-red">
            <div className="label">الخصومات</div>
            <div className="value">− {money(totDeduction)}</div>
          </div>
          <div className="kpi tone-red">
            <div className="label">السلف</div>
            <div className="value">− {money(totAdvance)}</div>
          </div>
          <div className="kpi tone-accent" style={{ borderWidth: 2 }}>
            <div className="label">صافي المستحق</div>
            <div className="value" style={{ fontSize: 20, fontWeight: 900 }}>{money(netSalary)}</div>
          </div>
        </div>
      </div>

      {/* ---- Tabs ---- */}
      <div className="list-tools" style={{ marginBottom: 0 }}>
        <button className={`btn ${tab === 'financial'  ? '' : 'ghost'}`} onClick={() => setTab('financial')}>
          💰 الحركات المالية
        </button>
        <button className={`btn ${tab === 'leaves'     ? '' : 'ghost'}`} onClick={() => setTab('leaves')}>
          🏖️ الإجازات
        </button>
        <button className={`btn ${tab === 'attendance' ? '' : 'ghost'}`} onClick={() => setTab('attendance')}>
          📅 الحضور
        </button>
      </div>

      {/* ---- Financial tab ---- */}
      {tab === 'financial' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '12px 0' }}>
            <button className="btn" onClick={openFinancial}>＋ إضافة حركة</button>
          </div>
          {financialRecs.length === 0 ? (
            <div className="card empty"><p>لا توجد حركات مالية في هذا الشهر</p></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>النوع</th><th>المبلغ</th><th>ملاحظة</th><th>التاريخ</th><th></th></tr>
                </thead>
                <tbody>
                  {[...financialRecs].reverse().map((r) => (
                    <tr key={r.id}>
                      <td><span className={`badge ${FIN_TYPES[r.type].color}`}>{FIN_TYPES[r.type].label}</span></td>
                      <td className="num" style={{ fontWeight: 700 }}>{money(r.amount)}</td>
                      <td className="muted">{r.note || '—'}</td>
                      <td className="muted">{r.day}</td>
                      <td><button className="btn danger sm" onClick={() => removeRecord(r)}>حذف</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ---- Leaves tab ---- */}
      {tab === 'leaves' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '12px 0' }}>
            <button className="btn" onClick={openLeave}>＋ إضافة إجازة</button>
          </div>
          {leaveRecs.length === 0 ? (
            <div className="card empty"><p>لا توجد إجازات في هذا الشهر</p></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>نوع الإجازة</th><th>عدد الأيام</th><th>تاريخ البداية</th><th>ملاحظة</th><th></th></tr>
                </thead>
                <tbody>
                  {[...leaveRecs].reverse().map((r) => (
                    <tr key={r.id}>
                      <td><span className="badge gray">{LEAVE_TYPES[r.leaveType] || r.leaveType}</span></td>
                      <td className="num">{fmt(r.days)} يوم</td>
                      <td className="muted">{r.day}</td>
                      <td className="muted">{r.note || '—'}</td>
                      <td><button className="btn danger sm" onClick={() => removeRecord(r)}>حذف</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ---- Attendance tab ---- */}
      {tab === 'attendance' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '12px 0' }}>
            <button className="btn" onClick={openAttendance}>＋ تسجيل حضور</button>
          </div>
          {attendanceRecs.length === 0 ? (
            <div className="card empty"><p>لا توجد سجلات حضور في هذا الشهر</p></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>الحالة</th><th>التاريخ</th><th>ملاحظة</th><th></th></tr>
                </thead>
                <tbody>
                  {[...attendanceRecs].reverse().map((r) => (
                    <tr key={r.id}>
                      <td>
                        <span className={`badge ${ATT_STATUS[r.attendanceStatus]?.color || 'gray'}`}>
                          {ATT_STATUS[r.attendanceStatus]?.label || r.attendanceStatus}
                        </span>
                      </td>
                      <td className="muted">{r.day}</td>
                      <td className="muted">{r.note || '—'}</td>
                      <td><button className="btn danger sm" onClick={() => removeRecord(r)}>حذف</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted" style={{ padding: '8px 14px' }}>
                حاضر: {attendanceRecs.filter((r) => r.attendanceStatus === 'present').length} ·
                غائب: {attendanceRecs.filter((r) => r.attendanceStatus === 'absent').length} ·
                متأخر: {attendanceRecs.filter((r) => r.attendanceStatus === 'late').length}
              </p>
            </div>
          )}
        </>
      )}

      {/* ---- Add record modal ---- */}
      {form && (
        <Modal
          title={
            form.type === 'leave'      ? 'إضافة إجازة'      :
            form.type === 'attendance' ? 'تسجيل حضور'       :
            'إضافة حركة مالية'
          }
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

            {/* financial: type selector */}
            {form.type in FIN_TYPES && (
              <div className="field">
                <label>النوع</label>
                <select
                  className="input"
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                >
                  <option value="bonus">حافز</option>
                  <option value="deduction">خصم</option>
                  <option value="advance">سلفة</option>
                </select>
              </div>
            )}

            {/* leave: type selector */}
            {form.type === 'leave' && (
              <div className="field">
                <label>نوع الإجازة</label>
                <select
                  className="input"
                  value={form.leaveType}
                  onChange={(e) => setForm({ ...form, leaveType: e.target.value })}
                >
                  <option value="annual">سنوية</option>
                  <option value="sick">مرضية</option>
                  <option value="unpaid">بدون راتب</option>
                  <option value="other">أخرى</option>
                </select>
              </div>
            )}

            {/* attendance: status selector */}
            {form.type === 'attendance' && (
              <div className="field">
                <label>الحالة</label>
                <select
                  className="input"
                  value={form.attendanceStatus}
                  onChange={(e) => setForm({ ...form, attendanceStatus: e.target.value })}
                >
                  <option value="present">حاضر</option>
                  <option value="absent">غائب</option>
                  <option value="late">متأخر</option>
                </select>
              </div>
            )}
          </div>

          {/* amount field for financial types */}
          {form.type in FIN_TYPES && (
            <div className="field">
              <label>المبلغ (ج.م) *</label>
              <input
                className="input lg"
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                placeholder="0"
                autoFocus
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </div>
          )}

          {/* days field for leave */}
          {form.type === 'leave' && (
            <div className="field">
              <label>عدد الأيام *</label>
              <input
                className="input"
                type="number"
                min="1"
                value={form.days}
                autoFocus
                onChange={(e) => setForm({ ...form, days: e.target.value })}
              />
            </div>
          )}

          <div className="field">
            <label>ملاحظة</label>
            <input
              className="input"
              value={form.note}
              placeholder={form.type === 'attendance' ? 'سبب الغياب أو التأخير...' : 'ملاحظة اختيارية...'}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </div>

          <button className="btn big block" onClick={saveRecord} disabled={!canSaveRecord}>
            💾 حفظ
          </button>
        </Modal>
      )}

      {/* ---- Edit employee modal ---- */}
      {editEmp && (
        <Modal title="تعديل بيانات الموظف" onClose={() => setEditEmp(null)}>
          <div className="row">
            <div className="field">
              <label>الاسم *</label>
              <input
                className="input"
                value={editEmp.name}
                autoFocus
                onChange={(e) => setEditEmp({ ...editEmp, name: e.target.value })}
              />
            </div>
            <div className="field">
              <label>الهاتف</label>
              <input
                className="input"
                inputMode="tel"
                value={editEmp.phone || ''}
                onChange={(e) => setEditEmp({ ...editEmp, phone: e.target.value })}
              />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>الوظيفة</label>
              <input
                className="input"
                value={editEmp.jobTitle || ''}
                onChange={(e) => setEditEmp({ ...editEmp, jobTitle: e.target.value })}
              />
            </div>
            <div className="field">
              <label>تاريخ التعيين</label>
              <input
                className="input"
                type="date"
                value={editEmp.hireDate || ''}
                onChange={(e) => setEditEmp({ ...editEmp, hireDate: e.target.value })}
              />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>المرتب الأساسي (ج.م)</label>
              <input
                className="input lg"
                type="number"
                min="0"
                value={editEmp.baseSalary}
                onChange={(e) => setEditEmp({ ...editEmp, baseSalary: e.target.value })}
              />
            </div>
            <div className="field">
              <label>الحالة</label>
              <select
                className="input"
                value={editEmp.status}
                onChange={(e) => setEditEmp({ ...editEmp, status: e.target.value })}
              >
                <option value="active">نشط</option>
                <option value="inactive">موقوف</option>
              </select>
            </div>
          </div>
          <button
            className="btn big block"
            onClick={saveEmp}
            disabled={!editEmp.name.trim()}
          >💾 حفظ التعديل</button>
        </Modal>
      )}
    </>
  );
}
