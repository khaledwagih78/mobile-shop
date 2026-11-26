// ---------- plans / editions (الخطط وباقات الاشتراك) ----------
// Four tiers:
// - free (مجانية): ERP core, no AI.
// - basic (أساسية): + accounting/treasury/installments/alerts/reportbuilder.
// - pro (احترافية): all features + AI (Gemini analysis & chatbot).
// - enterprise (شركات): everything in pro + company-grade extras (some upcoming).
// `price`/`period` are shown in the plan comparison — set them to your real prices.

const ALL_FEATS = [
  'accounting', 'treasury', 'installments', 'alerts', 'reportbuilder',
  'ai', 'crm', 'assets', 'payroll', 'projects', 'maintenance', 'reps',
  'production', 'pricing', 'delivery',
];

export const PLANS = [
  {
    id: 'free',
    name: 'مجانية (Free)',
    badge: 'gray',
    price: '0 ج.م',
    period: 'دائماً',
    hasAi: false,
    desc: 'المبيعات، المخزون، العملاء، الموردين، المصروفات، والتقارير الأساسية.',
    feats: [],
  },
  {
    id: 'basic',
    name: 'أساسية (Basic)',
    badge: 'amber',
    price: 'حدّد السعر',
    period: 'شهري',
    hasAi: false,
    desc: 'كل المجانية + المحاسبة والخزائن والأقساط والديون والتنبيهات ومنشئ التقارير.',
    feats: ['accounting', 'treasury', 'installments', 'alerts', 'reportbuilder'],
  },
  {
    id: 'pro',
    name: 'احترافية (Pro)',
    badge: 'green',
    price: 'حدّد السعر',
    period: 'شهري / سنوي',
    hasAi: true,
    recommended: true,
    desc: 'كافة مميزات النظام + التحليلات الذكية بالذكاء الاصطناعي (Gemini) ومستشار الدردشة التفاعلي.',
    allFeats: true,
    feats: ALL_FEATS,
  },
  {
    id: 'enterprise',
    name: 'شركات (Enterprise)',
    badge: 'green',
    price: 'حدّد السعر',
    period: 'شهري / سنوي',
    hasAi: true,
    desc: 'كل مميزات الاحترافية + إمكانيات المؤسسات والفروع الكبيرة.',
    allFeats: true,
    feats: ALL_FEATS,
    // مميزات باقة الشركات (بعضها قيد التطوير)
    extras: [
      'فروع غير محدودة',
      'مزامنة سحابية بين الأجهزة',
      'واجهة برمجية (API) للتكامل',
      'الفاتورة الإلكترونية (ETA)',
      'دعم فنّي بأولوية',
    ],
  },
];

// Human labels for the paid features
export const FEAT_LABELS = {
  ai: 'الذكاء الاصطناعي (التحليل الشامل ومستشار الدردشة)',
  accounting: 'المحاسبة المتقدمة',
  treasury: 'الخزائن والبنوك',
  installments: 'الأقساط والديون',
  alerts: 'مركز التنبيهات',
  reportbuilder: 'منشئ التقارير',
  crm: 'إدارة العملاء المحتملين',
  assets: 'الأصول الثابتة',
  payroll: 'الرواتب والبدلات',
  projects: 'المشاريع والمقاولات',
  maintenance: 'أوامر الصيانة والتشغيل',
  reps: 'إدارة المندوبين',
  production: 'أوامر التصنيع',
  pricing: 'قوائم الأسعار الخاصة',
  delivery: 'إدارة الشحن والتوصيل',
};

// Resolve a plan id to a tier, with back-compat for old stored values:
// 'full' (legacy) → pro. Unknown → free.
export const getPlan = (id) => {
  if (id === 'full') return PLANS.find((p) => p.id === 'pro') || PLANS[0];
  return PLANS.find((p) => p.id === id) || PLANS[0];
};

// Is a paid feature available under a plan?
export const featAllowed = (plan, feat) => {
  if (!feat) return true;
  const p = getPlan(plan);
  return p.allFeats === true || (p.feats || []).includes(feat);
};

// Check if AI features are unlocked under current plan
export const isAiAllowed = (plan) => featAllowed(plan, 'ai');
