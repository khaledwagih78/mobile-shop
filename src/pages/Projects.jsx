import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, today, queueSync, createProject, addProjectEntry } from '../db';
import { money, fmt } from '../utils';
import { Modal, Toast } from '../components/UI';
import { useAuth } from '../auth';

const proj = (p) => {
  const cost = (p.entries || []).filter((e) => e.type === 'cost').reduce((s, e) => s + e.amount, 0);
  const income = (p.entries || []).filter((e) => e.type === 'income').reduce((s, e) => s + e.amount, 0);
  const doneTasks = (p.tasks || []).filter((t) => t.done).length;
  return { cost, income, profit: income - cost, doneTasks, totalTasks: (p.tasks || []).length };
};

export default function Projects() {
  const { user, activeBranch } = useAuth();
  const projects = useLiveQuery(() => db.projects.orderBy('createdAt').reverse().toArray(), [], []);
  const customers = useLiveQuery(() => db.customers.toArray(), [], []);
  const [form, setForm] = useState(null);
  const [detail, setDetail] = useState(null);
  const [toast, setToast] = useState('');
  const notify = (m) => { setToast(m); setTimeout(() => setToast(''), 2500); };

  // keep the open detail in sync with live data
  const liveDetail = detail ? projects.find((p) => p.id === detail.id) || detail : null;

  const totals = useMemo(() => {
    const active = projects.filter((p) => p.status === 'active');
    let income = 0, cost = 0, budget = 0;
    for (const p of projects) { const s = proj(p); income += s.income; cost += s.cost; budget += (p.budget || 0); }
    return { count: active.length, income, cost, profit: income - cost, budget };
  }, [projects]);

  const save = async () => {
    const cust = customers.find((c) => c.id === Number(form.customerId));
    await createProject({
      name: form.name, customerId: cust ? cust.id : null, customerName: cust ? cust.name : '',
      budget: Number(form.budget) || 0, startDate: form.startDate, endDate: form.endDate, notes: form.notes,
      branchId: activeBranch, userName: user.name,
    });
    notify('✅ تم إنشاء المشروع');
    setForm(null);
  };

  const setStatus = async (p, status) => {
    await db.projects.update(p.id, { status });
    await queueSync('projects', 'update', { id: p.id, status });
  };

  const addTask = async (p, title) => {
    const tasks = [...(p.tasks || []), { key: `${Date.now()}`, title, done: false }];
    await db.projects.update(p.id, { tasks }); await queueSync('projects', 'update', { id: p.id, tasks });
  };
  const toggleTask = async (p, key) => {
    const tasks = (p.tasks || []).map((t) => t.key === key ? { ...t, done: !t.done } : t);
    await db.projects.update(p.id, { tasks }); await queueSync('projects', 'update', { id: p.id, tasks });
  };
  const addEntry = async (p, type, amount, note) => {
    await addProjectEntry({ projectId: p.id, type, amount, note, userName: user.name });
  };

  return (
    <>
      <div className="page-head">
        <h1>📁 المشاريع</h1>
        <button className="btn accent" onClick={() => setForm({ name: '', customerId: '', budget: '', startDate: today(), endDate: '', notes: '' })}>＋ مشروع جديد</button>
      </div>

      <div className="kpis">
        <div className="kpi"><div className="label">مشاريع نشطة</div><div className="value">{fmt(totals.count)}</div></div>
        <div className="kpi"><div className="label">إجمالي الميزانيات</div><div className="value">{money(totals.budget)}</div></div>
        <div className="kpi tone-green"><div className="label">إجمالي الإيرادات</div><div className="value">{money(totals.income)}</div></div>
        <div className="kpi" style={{ borderColor: totals.profit >= 0 ? 'var(--green)' : 'var(--red)' }}><div className="label">صافي ربح المشاريع</div><div className="value">{money(totals.profit)}</div></div>
      </div>

      {projects.length === 0 ? (
        <div className="card empty"><div className="big-ico">📁</div><p>لا توجد مشاريع — أنشئ مشروع وتابع تكاليفه وإيراداته وربحه</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>المشروع</th><th>العميل</th><th>الميزانية</th><th>تكاليف</th><th>إيرادات</th><th>الربح</th><th>المهام</th><th>الحالة</th><th></th></tr></thead>
            <tbody>
              {projects.map((p) => {
                const s = proj(p);
                return (
                  <tr key={p.id} className="clickable" onClick={() => setDetail(p)}>
                    <td><b>{p.name}</b></td>
                    <td className="muted">{p.customerName || '—'}</td>
                    <td className="num">{money(p.budget)}</td>
                    <td className="num" style={{ color: 'var(--red)' }}>{money(s.cost)}</td>
                    <td className="num" style={{ color: 'var(--green)' }}>{money(s.income)}</td>
                    <td className="num" style={{ fontWeight: 700, color: s.profit >= 0 ? 'var(--green)' : 'var(--red)' }}>{money(s.profit)}</td>
                    <td className="num muted">{s.doneTasks}/{s.totalTasks}</td>
                    <td>{p.status === 'active' ? <span className="badge green">نشط</span> : p.status === 'done' ? <span className="badge gray">منتهي</span> : <span className="badge amber">متوقف</span>}</td>
                    <td>▸</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <Modal title="مشروع جديد" onClose={() => setForm(null)}>
          <div className="field"><label>اسم المشروع *</label>
            <input className="input" value={form.name} autoFocus onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="row">
            <div className="field"><label>العميل (اختياري)</label>
              <select className="input" value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}>
                <option value="">—</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
            <div className="field"><label>الميزانية</label>
              <input className="input" type="number" min="0" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} placeholder="0" /></div>
          </div>
          <div className="row">
            <div className="field"><label>تاريخ البداية</label>
              <input className="input" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></div>
            <div className="field"><label>تاريخ الانتهاء</label>
              <input className="input" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></div>
          </div>
          <div className="field"><label>ملاحظات</label>
            <textarea className="input" rows="2" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          <button className="btn accent block" onClick={save} disabled={!form.name.trim()}>💾 حفظ</button>
        </Modal>
      )}

      {liveDetail && <ProjectDetail p={liveDetail} onClose={() => setDetail(null)} addTask={addTask} toggleTask={toggleTask} addEntry={addEntry} setStatus={setStatus} />}

      <Toast msg={toast} />
    </>
  );
}

function ProjectDetail({ p, onClose, addTask, toggleTask, addEntry, setStatus }) {
  const s = proj(p);
  const [task, setTask] = useState('');
  const [entry, setEntry] = useState({ type: 'cost', amount: '', note: '' });
  const budgetUsed = p.budget > 0 ? Math.round((s.cost / p.budget) * 100) : 0;

  return (
    <Modal title={`📁 ${p.name}`} onClose={onClose}>
      <p className="muted">{p.customerName ? `العميل: ${p.customerName} · ` : ''}{p.startDate}{p.endDate ? ` ← ${p.endDate}` : ''}</p>

      <div className="totals" style={{ marginBottom: 10 }}>
        <div className="trow"><span>الميزانية</span><span className="num">{money(p.budget)}</span></div>
        <div className="trow"><span>التكاليف</span><span className="num" style={{ color: 'var(--red)' }}>{money(s.cost)}{p.budget > 0 && ` (${budgetUsed}%)`}</span></div>
        <div className="trow"><span>الإيرادات</span><span className="num" style={{ color: 'var(--green)' }}>{money(s.income)}</span></div>
        <div className="trow grand" style={{ color: s.profit >= 0 ? 'var(--green)' : 'var(--red)' }}><span>صافي الربح</span><span className="num">{money(s.profit)}</span></div>
      </div>

      <div className="field">
        <label>الحالة</label>
        <div style={{ display: 'flex', gap: 6 }}>
          {['active', 'onhold', 'done'].map((st) => (
            <button key={st} className={`btn ${p.status === st ? 'accent' : 'ghost'} sm`} onClick={() => setStatus(p, st)}>
              {st === 'active' ? 'نشط' : st === 'onhold' ? 'متوقف' : 'منتهي'}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>المهام ({s.doneTasks}/{s.totalTasks})</label>
        {(p.tasks || []).map((t) => (
          <label key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', cursor: 'pointer' }}>
            <input type="checkbox" checked={t.done} onChange={() => toggleTask(p, t.key)} />
            <span style={{ textDecoration: t.done ? 'line-through' : 'none', opacity: t.done ? 0.6 : 1 }}>{t.title}</span>
          </label>
        ))}
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <input className="input" style={{ flex: 1 }} value={task} onChange={(e) => setTask(e.target.value)} placeholder="مهمة جديدة" />
          <button className="btn ghost sm" onClick={() => { if (task.trim()) { addTask(p, task.trim()); setTask(''); } }}>＋</button>
        </div>
      </div>

      <div className="field">
        <label>الحركات المالية</label>
        {(p.entries || []).length === 0 ? <p className="muted" style={{ fontSize: 12 }}>لا توجد حركات</p> : (
          <div style={{ maxHeight: 140, overflowY: 'auto' }}>
            {(p.entries || []).slice().reverse().map((e) => (
              <div key={e.key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, borderBottom: '1px solid var(--line)', padding: '4px 0' }}>
                <span>{e.type === 'cost' ? '🔴 تكلفة' : '🟢 إيراد'} {e.note ? `— ${e.note}` : ''} <span className="muted">{e.date}</span></span>
                <b className="num">{money(e.amount)}</b>
              </div>
            ))}
          </div>
        )}
        <div className="row" style={{ marginTop: 6 }}>
          <div className="field"><select className="input" value={entry.type} onChange={(e) => setEntry({ ...entry, type: e.target.value })}>
            <option value="cost">تكلفة</option><option value="income">إيراد</option>
          </select></div>
          <div className="field"><input className="input" type="number" min="0" value={entry.amount} onChange={(e) => setEntry({ ...entry, amount: e.target.value })} placeholder="المبلغ" /></div>
        </div>
        <input className="input" value={entry.note} onChange={(e) => setEntry({ ...entry, note: e.target.value })} placeholder="ملاحظة (اختياري)" style={{ marginBottom: 6 }} />
        <button className="btn block" onClick={() => { if (Number(entry.amount) > 0) { addEntry(p, entry.type, Number(entry.amount), entry.note); setEntry({ type: 'cost', amount: '', note: '' }); } }} disabled={!(Number(entry.amount) > 0)}>
          ＋ تسجيل الحركة (تنعكس في المحاسبة)
        </button>
      </div>
    </Modal>
  );
}
