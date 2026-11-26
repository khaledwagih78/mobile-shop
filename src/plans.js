// ---------- plans / editions (الخطط وباقات الاشتراك) ----------
// Tiered subscription architecture:
// - Free (المجانية): Basic ERP core operations — WITHOUT AI (بدون ذكاء اصطناعي).
// - Pro (الاحترافية): Full ERP advanced suite + Gemini AI Analysis & Interactive Chatbot (مع الذكاء الاصطناعي).

export const PLANS = [
  {
    id: 'free',
    name: 'مجانية (Free)',
    badge: 'gray',
    price: '0 ج.م',
    period: 'دائماً',
    hasAi: false,
    desc: 'المبيعات، المخزون، العملاء، الموردين، المصروفات، والتقارير الأساسية (بدون ذكاء اصطناعي).',
    feats: [],
  },
  {
    id: 'pro',
    name: 'احترافية (Pro)',
    badge: 'green',
    price: 'اشتراك مدفوع',
    period: 'شهري / سنوي',
    hasAi: true,
    desc: 'كافة مميزات النظام + التحليلات الذكية الشاملة بالذكاء الاصطناعي (Gemini) ومستشار الدردشة التفاعلي.',
    allFeats: true,
    feats: [
      'accounting',
      'treasury',
      'installments',
      'alerts',
      'reportbuilder',
      'ai',
      'crm',
      'assets',
      'payroll',
      'projects',
      'maintenance',
      'reps',
      'production',
      'pricing',
      'delivery',
    ],
  },
  // Backward compatibility aliases
  {
    id: 'basic',
    name: 'أساسية (Basic)',
    badge: 'amber',
    price: 'باقة سابقة',
    period: 'شهري',
    hasAi: false,
    desc: 'كل المجانية + المحاسبة والخزائن والأقساط والديون والتنبيهات ومنشئ التقارير (بدون ذكاء اصطناعي).',
    feats: ['accounting', 'treasury', 'installments', 'alerts', 'reportbuilder'],
  },
  {
    id: 'full',
    name: 'شاملة (Pro/Full)',
    badge: 'green',
    price: 'اشتراك كامل',
    period: 'شهري / سنوي',
    hasAi: true,
    desc: 'كافة المميزات مع الذكاء الاصطناعي.',
    allFeats: true,
    feats: [
      'accounting',
      'treasury',
      'installments',
      'alerts',
      'reportbuilder',
      'ai',
      'crm',
      'assets',
      'payroll',
      'projects',
      'maintenance',
      'reps',
      'production',
      'pricing',
      'delivery',
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

export const getPlan = (id) => {
  if (id === 'full') return PLANS.find((p) => p.id === 'pro') || PLANS[1];
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
