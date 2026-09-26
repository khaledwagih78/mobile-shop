// ---------- plans / editions (الخطط والإصدارات) ----------
// A soft, client-side edition system for promotion (freemium). The active plan
// lives in the `plan` setting. Each menu item that belongs to a paid tier carries
// a `feat` key (see Layout.jsx MENU); a plan lists the `feats` it unlocks (or
// `allFeats: true`). Core sections (sales, inventory, customers, suppliers,
// expenses, reports, backup, import, users, branches, settings…) carry NO `feat`,
// so they work on every plan — including the free one.
//
// NOTE: with no backend this is honor-system gating (good for marketing, not DRM).
// A real lock would need a server / activation key.

export const PLANS = [
  {
    id: 'free', name: 'مجانية', ico: '🆓', badge: 'gray',
    desc: 'للتجربة والدعاية — المبيعات والمخزون والعملاء والموردين والمصروفات والتقارير الأساسية.',
    feats: [],
  },
  {
    id: 'basic', name: 'أساسية', ico: '⭐', badge: 'amber',
    desc: 'كل المجانية + المحاسبة والخزائن والأقساط والديون والتنبيهات ومنشئ التقارير.',
    feats: ['accounting', 'treasury', 'installments', 'alerts', 'reportbuilder'],
  },
  {
    id: 'full', name: 'كاملة', ico: '💎', badge: 'green',
    desc: 'كل المميزات: CRM وأصول ورواتب ومشاريع وصيانة ومندوبين وتصنيع وقوائم أسعار وتوصيل والذكاء الاصطناعي والتقارير الدورية.',
    allFeats: true, feats: [],
  },
];

// Human labels for the paid features (used in Settings comparison).
export const FEAT_LABELS = {
  accounting: 'المحاسبة 📒',
  treasury: 'الخزائن والبنوك 🏦',
  installments: 'الأقساط والديون 💳',
  alerts: 'مركز التنبيهات 🔔',
  reportbuilder: 'منشئ التقارير 🧱',
  ai: 'الذكاء الاصطناعي (مساعد/تحليلات/استيراد/صوت) 🤖',
  crm: 'العملاء المحتملون 🤝',
  assets: 'الأصول الثابتة 🏛️',
  payroll: 'الرواتب 💵',
  projects: 'المشاريع 📁',
  maintenance: 'الصيانة وأوامر العمل 🔧',
  reps: 'المندوبون 🚶',
  production: 'التصنيع 🏭',
  pricing: 'قوائم الأسعار 🏷️',
  delivery: 'التوصيل 🚗',
};

export const getPlan = (id) => PLANS.find((p) => p.id === id) || PLANS[PLANS.length - 1];

// Is a paid feature available under a plan?
export const featAllowed = (plan, feat) => {
  if (!feat) return true;
  const p = getPlan(plan);
  return p.allFeats === true || (p.feats || []).includes(feat);
};
