import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db, nowISO, today, queueSync, convertLead } from '../db';
import { money, fmt, fmtDay, waLink } from '../utils';
import { Modal, Toast } from '../components/UI';
import { useAuth } from '../auth';

export const STAGES = [
  { key: 'new', label: 'جديد', cls: 'gray' },
  { key: 'contacted', label: 'تم التواصل', cls: 'accent' },
  { key: 'quoted', label: 'عرض سعر', cls: 'amber' },
  { key: 'negotiation', label: 'تفاوض', cls: 'amber' },
  { key: 'won', label: 'ربح ✓', cls: 'green' },
  { key: 'lost', label: 'خسارة', cls: 'red' },
];
const SOURCES = ['اتصال', 'واتساب', 'زيارة', 'فيسبوك', 'إعلان', 'ترشيح', 'أخرى'];
const EMPTY = { name: '', phone: '', company: '', source: SOURCES[0], stage: 'new', value: '', probability: '50', nextFollowUp: '', notes: '', activities: [] };

export default function CRM() {
  const { user, activeBranch } = useAuth();
  const nav = useNavigate();
  const leads = useLiveQuery(() => db.leads.orderBy('createdAt').reverse().toArray(), [], []);
  const [form, setForm] = useState(null);
  const [toast, setToast] = useState('');
  const t = today();
  const notify = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const openLeads = leads.filter((l) => l.status !== 'won' && l.status !== 'lost');
  const pipelineValue = openLeads.reduce((s, l) => s + (Number(l.value) || 0) * (Number(l.probability) || 0) / 100, 0);
  const wonThisMonth = leads.filter((l) => l.stage === 'won' && (l.createdAt || '').slice(0, 7) === t.slice(0, 7)).reduce((s, l) => s + (Number(l.value) || 0), 0);
  const dueFollowUps = openLeads.filter((l) => l.nextFollowUp && l.nextFollowUp <= t);

  const byStage = useMemo(() => {
    const m = {}; for (const s of STAGES) m[s.key] = [];
    for (const l of leads) (m[l.stage] || (m[l.stage] = [])).push(l);
    return m;
  }, [leads]);

  const save = async () => {
    const doc = {
      name: form.name.trim(), phone: form.phone.trim(), company: form.company.trim(),
      source: form.source, stage: form.stage, value: Number(form.value) || 0,
      probability: Number(form.probability) || 0, nextFollowUp: form.nextFollowUp || null,
      notes: form.notes || '', activities: form.activities || [],
      status: form.stage === 'won' ? 'won' : form.stage === 'lost' ? 'lost' : 'open',
      branchId: activeBranch, ownerName: user.name,
    };
    if (form.id) {
      await db.leads.update(form.id, doc);
      await queueSync('leads', 'update', { ...doc, id: form.id });
    } else {
      doc.createdAt = nowISO();
      const id = await db.leads.add(doc);
      await queueSync('leads', 'add', { ...doc, id });
    }
    setForm(null);
  };

  const moveStage = async (lead, stage) => {
    const status = stage === 'won' ? 'won' : stage === 'lost' ? 'lost' : 'open';
    await db.leads.update(lead.id, { stage, status });
    await queueSync('leads', 'update', { id: lead.id, stage, status });
  };

  const remove = async (lead) => {
    if (!confirm(`حذف العميل المحتمل "${lead.name}"؟`)) return;
    await db.leads.delete(lead.id);
    await queueSync('leads', 'delete', { id: lead.id });
  };

  const convert = async (lead) => {
    const cid = await convertLead(lead.id);
    if (cid) { notify('✅ تم تحويله لعميل'); }
  };

  const addActivity = (type) => {
    const note = prompt(type === 'call' ? 'تفاصيل المكالمة:' : type === 'meeting' ? 'تفاصيل الاجتماع:' : 'ملاحظة:');
    if (note == null) return;
    setForm((f) => ({ ...f, activities: [...(f.activities || []), { type, note, date: nowISO() }] }));
  };

  return (
    <>
      <div className="page-head">
        <h1>🤝 العملاء المحتملون (CRM)</h1>
        <button className="btn accent" onClick={() => setForm({ ...EMPTY })}>＋ عميل محتمل</button>
      </div>

      <div className="kpis">
        <div className="kpi"><div className="label">فرص مفتوحة</div><div className="value">{fmt(openLeads.length)}</div></div>
        <div className="kpi tone-accent"><div className="label">القيمة المتوقعة (مرجّحة)</div><div className="value">{money(pipelineValue)}</div></div>
        <div className="kpi tone-green"><div className="label">مكسوبة هذا الشهر</div><div className="value">{money(wonThisMonth)}</div></div>
        {dueFollowUps.length > 0 && <div className="kpi tone-red"><div className="label">متابعات مستحقة</div><div className="value">{fmt(dueFollowUps.length)}</div></div>}
      </div>

      {dueFollowUps.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--amber)', marginBottom: 12 }}>
          <b>⏰ متابعات مستحقة اليوم أو متأخرة:</b>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
            {dueFollowUps.map((l) => (
              <button key={l.id} className="btn ghost sm" onClick={() => setForm({ ...EMPTY, ...l })}>{l.name} — {l.nextFollowUp}</button>
            ))}
          </div>
        </div>
      )}

      {leads.length === 0 ? (
        <div className="card empty"><div className="big-ico">🤝</div><p>لا يوجد عملاء محتملون — أضف أول فرصة بيع</p></div>
      ) : (
        <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 8 }}>
          {STAGES.map((s) => (
            <div key={s.key} style={{ minWidth: 230, flex: '0 0 230px' }}>
              <div className="card" style={{ padding: 10, marginBottom: 8, textAlign: 'center' }}>
                <b>{s.label}</b> <span className="muted">({(byStage[s.key] || []).length})</span>
                <div className="muted" style={{ fontSize: 12 }}>{money((byStage[s.key] || []).reduce((a, l) => a + (Number(l.value) || 0), 0))}</div>
              </div>
              {(byStage[s.key] || []).map((l) => {
                const overdue = l.nextFollowUp && l.nextFollowUp <= t && l.status === 'open';
                return (
                  <div key={l.id} className="card" style={{ padding: 10, marginBottom: 8, borderColor: overdue ? 'var(--amber)' : undefined }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                      <b>{l.name}</b>
                      <span className="num muted" style={{ fontSize: 12 }}>{l.value ? money(l.value) : ''}</span>
                    </div>
                    {l.company && <div className="muted" style={{ fontSize: 12 }}>{l.company}</div>}
                    {l.phone && <div className="muted" style={{ fontSize: 12 }}>{l.phone}</div>}
                    {l.nextFollowUp && <div style={{ fontSize: 12, color: overdue ? 'var(--amber)' : 'var(--muted)' }}>⏰ {l.nextFollowUp}</div>}
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                      <select className="input" style={{ fontSize: 11, padding: '2px 4px', maxWidth: 120 }} value={l.stage} onChange={(e) => moveStage(l, e.target.value)}>
                        {STAGES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                      </select>
                      {l.phone && <a className="btn ghost sm" style={{ color: 'var(--green)' }} target="_blank" rel="noreferrer" href={waLink(l.phone, `مرحباً ${l.name}`)}>📲</a>}
                      <button className="btn ghost sm" onClick={() => setForm({ ...EMPTY, ...l })}>✎</button>
                      {!l.customerId
                        ? <button className="btn ghost sm" title="تحويل لعميل" onClick={() => convert(l)}>➡️👤</button>
                        : <button className="btn ghost sm" title="عرض سعر" onClick={() => nav('/quote')}>📄</button>}
                      <button className="btn ghost sm" onClick={() => remove(l)}>🗑️</button>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {form && (
        <Modal title={form.id ? `تعديل: ${form.name}` : 'عميل محتمل جديد'} onClose={() => setForm(null)}>
          <div className="row">
            <div className="field"><label>الاسم *</label>
              <input className="input" value={form.name} autoFocus onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="field"><label>الهاتف</label>
              <input className="input" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          </div>
          <div className="row">
            <div className="field"><label>الشركة / الجهة</label>
              <input className="input" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></div>
            <div className="field"><label>المصدر</label>
              <select className="input" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
                {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select></div>
          </div>
          <div className="row">
            <div className="field"><label>المرحلة</label>
              <select className="input" value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
                {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select></div>
            <div className="field"><label>القيمة المتوقعة</label>
              <input className="input" type="number" min="0" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} /></div>
            <div className="field"><label>احتمالية % </label>
              <input className="input" type="number" min="0" max="100" value={form.probability} onChange={(e) => setForm({ ...form, probability: e.target.value })} /></div>
          </div>
          <div className="field"><label>تاريخ المتابعة القادمة</label>
            <input className="input" type="date" value={form.nextFollowUp || ''} onChange={(e) => setForm({ ...form, nextFollowUp: e.target.value })} /></div>
          <div className="field"><label>ملاحظات</label>
            <textarea className="input" rows="2" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>

          <div className="field">
            <label>سجل الأنشطة</label>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <button className="btn ghost sm" type="button" onClick={() => addActivity('call')}>📞 مكالمة</button>
              <button className="btn ghost sm" type="button" onClick={() => addActivity('meeting')}>🤝 اجتماع</button>
              <button className="btn ghost sm" type="button" onClick={() => addActivity('note')}>📝 ملاحظة</button>
            </div>
            {(form.activities || []).length === 0 ? <p className="muted" style={{ fontSize: 12 }}>لا يوجد نشاط بعد</p> : (
              <div style={{ maxHeight: 140, overflowY: 'auto' }}>
                {(form.activities || []).slice().reverse().map((a, i) => (
                  <div key={i} style={{ fontSize: 12, borderBottom: '1px solid var(--line)', padding: '4px 0' }}>
                    <b>{a.type === 'call' ? '📞' : a.type === 'meeting' ? '🤝' : '📝'}</b> {a.note}
                    <span className="muted"> · {a.date?.slice(0, 10)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button className="btn block" onClick={save} disabled={!form.name.trim()}>💾 حفظ</button>
        </Modal>
      )}

      <Toast msg={toast} />
    </>
  );
}
