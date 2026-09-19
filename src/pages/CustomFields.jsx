import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getCustomFields, saveCustomFields } from '../db';
import { Toast } from '../components/UI';

const ENTITIES = [
  { id: 'item', label: '📦 الأصناف' },
  { id: 'customer', label: '👥 العملاء' },
  { id: 'supplier', label: '🚚 الموردين' },
];
const TYPES = [
  { id: 'text', label: 'نص' },
  { id: 'number', label: 'رقم' },
  { id: 'date', label: 'تاريخ' },
];
const entityLabel = (id) => ENTITIES.find((e) => e.id === id)?.label || id;
const typeLabel = (id) => TYPES.find((t) => t.id === id)?.label || id;

export default function CustomFields() {
  const fields = useLiveQuery(() => getCustomFields(), [], []);
  const [entity, setEntity] = useState('item');
  const [label, setLabel] = useState('');
  const [type, setType] = useState('text');
  const [toast, setToast] = useState('');

  const add = async () => {
    if (!label.trim()) return;
    const id = 'cf_' + Date.now().toString(36) + Math.floor(Math.random() * 1e4);
    await saveCustomFields([...(fields || []), { id, entity, label: label.trim(), type }]);
    setLabel('');
    setToast('✅ تم إضافة الحقل');
    setTimeout(() => setToast(''), 2000);
  };

  const remove = async (f) => {
    if (!confirm(`حذف الحقل "${f.label}"؟ (القيم المسجّلة تفضل محفوظة على السجلات)`)) return;
    await saveCustomFields((fields || []).filter((x) => x.id !== f.id));
  };

  return (
    <>
      <div className="page-head"><h1>🧩 الحقول المخصّصة</h1></div>

      <div className="card" style={{ maxWidth: 720, marginBottom: 16 }}>
        <p className="muted" style={{ marginTop: 0 }}>
          أضف خانات خاصة بمجالك تظهر في شاشة الأصناف/العملاء. مثال: للمقاولات "رقم المشروع"،
          للصيدلية "تاريخ الصلاحية"، للسوبر ماركت "الوحدة". أي حقل تضيفه هيظهر في نموذج
          الإضافة/التعديل للسجل المرتبط بيه.
        </p>
        <div className="row">
          <div className="field"><label>يظهر في</label>
            <select className="input" value={entity} onChange={(e) => setEntity(e.target.value)}>
              {ENTITIES.map((en) => <option key={en.id} value={en.id}>{en.label}</option>)}
            </select></div>
          <div className="field"><label>اسم الحقل *</label>
            <input className="input" value={label} onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="مثال: رقم المشروع" /></div>
          <div className="field"><label>النوع</label>
            <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
              {TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select></div>
        </div>
        <button className="btn" onClick={add} disabled={!label.trim()}>＋ إضافة الحقل</button>
      </div>

      <div className="section-title">الحقول الحالية ({fields.length})</div>
      {fields.length === 0 ? (
        <div className="card empty"><div className="big-ico">🧩</div><p>لا توجد حقول مخصّصة — أضف أول حقل لمجالك.</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>الحقل</th><th>يظهر في</th><th>النوع</th><th></th></tr></thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.id}>
                  <td><b>{f.label}</b></td>
                  <td>{entityLabel(f.entity)}</td>
                  <td className="muted">{typeLabel(f.type)}</td>
                  <td><button className="btn ghost sm" onClick={() => remove(f)}>حذف</button></td>
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

// Reusable: render inputs for an entity's custom fields, bound to values[fieldId].
export function CustomFieldInputs({ fields, values, onChange }) {
  if (!fields || fields.length === 0) return null;
  return (
    <>
      {fields.map((f) => (
        <div className="field" key={f.id}>
          <label>{f.label}</label>
          <input
            className="input"
            type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
            value={(values && values[f.id]) || ''}
            onChange={(e) => onChange(f.id, e.target.value)}
          />
        </div>
      ))}
    </>
  );
}
