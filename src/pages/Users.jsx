import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, nowISO, queueSync, DEFAULT_BRANCH_ID } from '../db';
import { ROLES } from '../utils';
import { Modal } from '../components/UI';
import { useAuth } from '../auth';

export default function Users() {
  const { user, branches } = useAuth();
  const users = useLiveQuery(() => db.users.toArray(), [], []);
  const [form, setForm] = useState(null);
  const branchName = (id) => branches.find((b) => b.id === id)?.name || '—';

  const save = async () => {
    // admins see every branch (null); other roles are pinned to one branch
    const branchId = form.role === 'admin' ? null : (Number(form.branchId) || DEFAULT_BRANCH_ID);
    if (form.id) {
      const patch = { name: form.name, role: form.role, branchId };
      if (form.pin) patch.pin = form.pin;
      await db.users.update(form.id, patch);
      await queueSync('users', 'update', { id: form.id, ...patch });
    } else {
      const doc = { name: form.name, pin: form.pin, role: form.role, branchId, createdAt: nowISO() };
      const id = await db.users.add(doc);
      await queueSync('users', 'add', { ...doc, id });
    }
    setForm(null);
  };

  const remove = async (u) => {
    if (u.id === user.id) return alert('لا يمكنك حذف حسابك الحالي');
    if (confirm(`حذف المستخدم ${u.name}؟`)) {
      await db.users.delete(u.id);
      await queueSync('users', 'delete', { id: u.id });
    }
  };

  return (
    <>
      <div className="page-head">
        <h1>🔑 المستخدمين والصلاحيات</h1>
        <button className="btn" onClick={() => setForm({ name: '', pin: '', role: 'sales', branchId: DEFAULT_BRANCH_ID })}>＋ مستخدم جديد</button>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>الاسم</th><th>الدور</th><th>الفرع</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td><b>{u.name}</b></td>
                <td><span className="badge primary">{ROLES[u.role]}</span></td>
                <td className="muted">{u.role === 'admin' ? 'كل الفروع' : branchName(u.branchId || DEFAULT_BRANCH_ID)}</td>
                <td style={{ display: 'flex', gap: 6 }}>
                  <button className="btn ghost sm" onClick={() => setForm({ ...u, pin: '', branchId: u.branchId || DEFAULT_BRANCH_ID })}>تعديل</button>
                  <button className="btn danger sm" onClick={() => remove(u)}>حذف</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <b>الصلاحيات:</b>
        <ul className="muted" style={{ margin: '8px 0 0', paddingRight: 18, lineHeight: 2 }}>
          <li><b>مدير النظام:</b> كل الشاشات + إلغاء الفواتير + التقارير + النسخ الاحتياطي</li>
          <li><b>موظف مبيعات:</b> البيع والعملاء والفواتير فقط — بدون تقارير أو تعديل مخزون</li>
          <li><b>أمين مخزن:</b> المخزون والمشتريات والموردين — بدون بيع أو تقارير</li>
        </ul>
      </div>

      {form && (
        <Modal title={form.id ? `تعديل: ${form.name}` : 'مستخدم جديد'} onClose={() => setForm(null)}>
          <div className="field"><label>الاسم *</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></div>
          <div className="field"><label>الرقم السري (PIN) {form.id ? '— اتركه فارغاً للإبقاء على الحالي' : '*'}</label>
            <input className="input" inputMode="numeric" value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value })} /></div>
          <div className="field"><label>الدور</label>
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          {form.role !== 'admin' && (
            <div className="field"><label>الفرع</label>
              <select className="input" value={form.branchId} onChange={(e) => setForm({ ...form, branchId: Number(e.target.value) })}>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select></div>
          )}
          <button className="btn block" onClick={save} disabled={!form.name.trim() || (!form.id && !form.pin)}>💾 حفظ</button>
        </Modal>
      )}
    </>
  );
}
