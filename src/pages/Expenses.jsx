import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, nowISO, dayOf, queueSync } from '../db';
import { money, fmtDate } from '../utils';
import { Modal } from '../components/UI';
import { useAuth } from '../auth';

export default function Expenses() {
  const { user } = useAuth();
  const expenses = useLiveQuery(() => db.expenses.orderBy('createdAt').reverse().limit(200).toArray(), [], []);
  const [form, setForm] = useState(null);

  const save = async () => {
    const createdAt = nowISO();
    const doc = { title: form.title, amount: Number(form.amount), userName: user.name, createdAt, day: dayOf(createdAt) };
    const id = await db.expenses.add(doc);
    await queueSync('expenses', 'add', { ...doc, id });
    setForm(null);
  };

  return (
    <>
      <div className="page-head">
        <h1>💸 المصروفات</h1>
        <button className="btn" onClick={() => setForm({ title: '', amount: '' })}>＋ مصروف جديد</button>
      </div>

      {expenses.length === 0 ? (
        <div className="card empty"><div className="big-ico">💸</div><p>لا توجد مصروفات مسجلة</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>البيان</th><th>المبلغ</th><th>بواسطة</th><th>التاريخ</th></tr></thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id}>
                  <td>{e.title}</td>
                  <td className="num" style={{ color: 'var(--red)' }}>{money(e.amount)}</td>
                  <td className="muted">{e.userName}</td>
                  <td className="muted">{fmtDate(e.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <Modal title="مصروف جديد" onClose={() => setForm(null)}>
          <div className="field"><label>البيان *</label>
            <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="كهرباء / إيجار / بنزين السيارة..." autoFocus /></div>
          <div className="field"><label>المبلغ *</label>
            <input className="input" type="number" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
          <button className="btn block" onClick={save} disabled={!form.title.trim() || !Number(form.amount)}>💾 حفظ</button>
        </Modal>
      )}
    </>
  );
}
