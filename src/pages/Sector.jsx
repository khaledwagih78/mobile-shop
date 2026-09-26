import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSetting, setSetting } from '../db';
import { SECTORS } from '../sectors';
import { Toast } from '../components/UI';

// Human labels for the specialized modules a sector can reveal.
const MOD_LABELS = {
  production: 'التصنيع 🏭',
  repair: 'الصيانة 🔧',
  installments: 'الأقساط والديون 💳',
  assets: 'الأصول الثابتة 🏛️',
  projects: 'المشاريع 📁',
  crm: 'العملاء المحتملون 🤝',
  wholesale: 'قوائم الأسعار 🏷️',
  reps: 'المندوبون 🚶',
  delivery: 'التوصيل 🚗',
};

export default function Sector() {
  const current = useLiveQuery(() => getSetting('bizSector', 'general'), [], 'general');
  const [toast, setToast] = useState('');

  const pick = async (id) => {
    await setSetting('bizSector', id);
    import('../sync').then((m) => m.triggerSync()).catch(() => {});
    const s = SECTORS.find((x) => x.id === id);
    setToast(`✅ تم اختيار المجال: ${s ? s.name : ''}`);
    setTimeout(() => setToast(''), 2500);
  };

  return (
    <>
      <div className="page-head"><h1>🧭 مجال النشاط</h1></div>

      <div className="card" style={{ maxWidth: 820 }}>
        <p className="muted" style={{ marginTop: 0 }}>
          اختر مجال شغلك، والتطبيق هيظهر لك <b>الأدوات اللي محتاجها المجال ده بس</b> ويسمّي الشاشات
          بأسماء مناسبة. الأدوات الخاصة بكل مجال بتفضل <b>مخفية</b> لحد ما تختار المجال المناسب —
          وتقدر تغيّر المجال في أي وقت من غير ما تفقد أي بيانات.
        </p>
        <p className="muted" style={{ fontSize: 12 }}>
          مثال: لما تختار <b>مصنع</b> بيظهر لك زر <b>التصنيع 🏭</b> (تحويل مواد خام لمنتج نهائي)،
          وبتتسمّى شاشة المخزون <b>"المواد والمنتجات"</b> والموظفين <b>"العمال"</b> والمصروفات <b>"تكاليف التشغيل"</b>.
        </p>
      </div>

      <div className="sector-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 12, marginTop: 16 }}>
        {SECTORS.map((s) => {
          const active = current === s.id;
          return (
            <button
              key={s.id}
              className="card"
              onClick={() => pick(s.id)}
              style={{
                textAlign: 'right', cursor: 'pointer', border: active ? '2px solid var(--accent, #0F4C5C)' : '1px solid var(--line,#ddd)',
                background: active ? 'var(--bg, #f6f8f9)' : 'var(--card, #fff)', display: 'flex', flexDirection: 'column', gap: 6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 28 }}>{s.ico}</span>
                <b style={{ fontSize: 16 }}>{s.name}</b>
                {active && <span className="badge green" style={{ marginRight: 'auto' }}>مُختار ✓</span>}
              </div>
              <span className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>{s.desc}</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
                {s.allMods ? (
                  <span className="badge green" style={{ fontSize: 11 }}>كل الأقسام ظاهرة</span>
                ) : (s.mods || []).length ? (
                  (s.mods || []).map((mod) => (
                    <span key={mod} className="badge amber" style={{ fontSize: 11 }}>{MOD_LABELS[mod] || mod}</span>
                  ))
                ) : (
                  <span className="badge gray" style={{ fontSize: 11 }}>الأقسام الأساسية فقط</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <Toast msg={toast} />
    </>
  );
}
