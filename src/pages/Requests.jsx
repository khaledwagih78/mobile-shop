import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, nowISO, queueSync } from '../db';
import { fmtDate } from '../utils';
import { useAuth } from '../auth';
import { Toast } from '../components/UI';

const CATS = [
  { id: 'feature', label: '✨ ميزة جديدة' },
  { id: 'field', label: '🏭 دعم مجال/نشاط جديد' },
  { id: 'change', label: '🔧 تعديل/تحسين' },
  { id: 'bug', label: '🐞 مشكلة/عطل' },
];
const catLabel = (id) => CATS.find((c) => c.id === id)?.label || id;

export default function Requests() {
  const { user } = useAuth();
  const requests = useLiveQuery(
    () => db.requests.orderBy('createdAt').reverse().toArray(), [], []
  );
  const [category, setCategory] = useState('feature');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [toast, setToast] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    const doc = {
      title: title.trim(), details: details.trim(), category,
      status: 'new', requesterName: user.name, requesterRole: user.role, createdAt: nowISO(),
    };
    const id = await db.requests.add(doc);
    await queueSync('requests', 'add', { ...doc, id });
    // best-effort email to the shop owner (if EmailJS is configured)
    import('../notify').then((m) => m.notifyEvent({
      action: 'request',
      title: `📝 طلب جديد: ${doc.title}`,
      body: `${catLabel(category)}\nمن: ${doc.requesterName}\n\n${doc.title}\n${doc.details}`,
    })).catch(() => {});
    setTitle(''); setDetails(''); setCategory('feature');
    setToast('✅ تم إرسال طلبك — شكراً لك!');
    setSaving(false);
    setTimeout(() => setToast(''), 3000);
  };

  const setStatus = async (r, status) => {
    await db.requests.update(r.id, { status });
    await queueSync('requests', 'update', { id: r.id, status });
  };

  const isAdmin = user.role === 'admin';

  return (
    <>
      <div className="page-head"><h1>📝 الطلبات والاقتراحات</h1></div>

      <div className="card" style={{ maxWidth: 700, marginBottom: 16 }}>
        <p className="muted" style={{ marginTop: 0 }}>
          محتاج ميزة معينة لمجالك؟ عندك اقتراح لتطوير البرنامج؟ اكتبه هنا — كل الطلبات بتتجمّع
          وبتوصل لصاحب البرنامج ليتم تطويرها وإضافتها في التحديثات القادمة.
        </p>
        <div className="row">
          <div className="field"><label>نوع الطلب</label>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select></div>
          <div className="field"><label>عنوان الطلب *</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثال: إضافة إدارة مشاريع للمقاولات" /></div>
        </div>
        <div className="field"><label>التفاصيل</label>
          <textarea className="input" rows={4} value={details} onChange={(e) => setDetails(e.target.value)}
            placeholder="اشرح الميزة اللي محتاجها وإزاي تفيدك في شغلك..." style={{ resize: 'vertical' }} /></div>
        <button className="btn big" onClick={submit} disabled={saving || !title.trim()}>📨 إرسال الطلب</button>
      </div>

      <div className="section-title">الطلبات المُرسلة ({requests.length})</div>
      {requests.length === 0 ? (
        <div className="card empty"><div className="big-ico">📝</div><p>لا توجد طلبات بعد — كن أول من يقترح!</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>النوع</th><th>الطلب</th><th>مِن</th><th>الحالة</th><th>التاريخ</th>{isAdmin && <th></th>}</tr></thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td>{catLabel(r.category)}</td>
                  <td><b>{r.title}</b>{r.details ? <div className="muted" style={{ fontSize: 12 }}>{r.details}</div> : null}</td>
                  <td className="muted">{r.requesterName}</td>
                  <td>
                    {r.status === 'done' ? <span className="badge green">تم ✅</span>
                      : r.status === 'planned' ? <span className="badge amber">قيد التنفيذ</span>
                      : <span className="badge primary">جديد</span>}
                  </td>
                  <td className="muted">{fmtDate(r.createdAt)}</td>
                  {isAdmin && (
                    <td style={{ display: 'flex', gap: 4 }}>
                      <button className="btn ghost sm" onClick={() => setStatus(r, 'planned')}>قيد التنفيذ</button>
                      <button className="btn ghost sm" onClick={() => setStatus(r, 'done')}>تم</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Toast msg={toast} />
    </>
  );
}
