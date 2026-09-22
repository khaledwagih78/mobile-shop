import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, nowISO, queueSync, DEFAULT_BRANCH_ID } from '../db';
import { Modal } from '../components/UI';

const EMPTY = { name: '', phone: '', address: '' };

export default function Branches() {
  const branches = useLiveQuery(
    async () => (await db.branches.toArray()).filter((b) => b.status !== 'deleted'),
    [], []
  );
  const [form, setForm] = useState(null);

  const save = async () => {
    const name = (form.name || '').trim();
    if (!name) return;
    if (form.id) {
      const doc = { name, phone: form.phone || '', address: form.address || '' };
      await db.branches.update(form.id, doc);
      await queueSync('branches', 'update', { ...doc, id: form.id });
    } else {
      const doc = { name, phone: form.phone || '', address: form.address || '', status: 'active', createdAt: nowISO() };
      const id = await db.branches.add(doc);
      await queueSync('branches', 'add', { ...doc, id });
    }
    setForm(null);
  };

  const remove = async (b) => {
    if (b.id === DEFAULT_BRANCH_ID) return alert('لا يمكن حذف الفرع الرئيسي');
    if (!confirm(`إخفاء الفرع "${b.name}"؟ (بضاعته تفضل محفوظة)`)) return;
    await db.branches.update(b.id, { status: 'deleted' });
    await queueSync('branches', 'update', { id: b.id, status: 'deleted' });
  };

  return (
    <>
      <div className="page-head">
        <h1>🏢 الفروع <span className="muted" style={{ fontSize: 14 }}>({branches.length})</span></h1>
        <button className="btn" onClick={() => setForm({ ...EMPTY })}>＋ فرع جديد</button>
      </div>

      {branches.length === 0 ? (
        <div className="card empty"><div className="big-ico">🏢</div><p>لا توجد فروع</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>اسم الفرع</th><th>الهاتف</th><th>العنوان</th><th></th></tr></thead>
            <tbody>
              {branches.map((b) => (
                <tr key={b.id}>
                  <td><b>{b.name}</b>{b.id === DEFAULT_BRANCH_ID && <span className="badge green" style={{ marginRight: 6, fontSize: 10 }}>رئيسي</span>}</td>
                  <td className="muted">{b.phone || '—'}</td>
                  <td className="muted">{b.address || '—'}</td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button className="btn ghost sm" onClick={() => setForm({ ...b })}>تعديل</button>
                    {b.id !== DEFAULT_BRANCH_ID && <button className="btn ghost sm" onClick={() => remove(b)}>حذف</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <Modal title={form.id ? `تعديل: ${form.name}` : 'فرع جديد'} onClose={() => setForm(null)}>
          <div className="field"><label>اسم الفرع *</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="مثال: فرع بني مزار" /></div>
          <div className="row">
            <div className="field"><label>الهاتف</label>
              <input className="input" value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div className="field"><label>العنوان</label>
              <input className="input" value={form.address || ''} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
          </div>
          <button className="btn block" onClick={save} disabled={!(form.name || '').trim()}>💾 حفظ</button>
        </Modal>
      )}
    </>
  );
}
