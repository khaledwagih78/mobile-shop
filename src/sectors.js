// ---------- business sectors (المجال / النشاط) ----------
// Choosing a sector tailors the app: it reveals sector-specific modules that
// stay HIDDEN otherwise (via a menu item's `mod` key), and relabels a few
// generic screens with names that fit the trade. Everything is config-driven —
// no feature is deleted, so switching sector never loses data (routes still
// work if typed; only the nav link is hidden).
//
// Each sector:
//   id      — stored in settings under `bizSector`
//   name    — Arabic label shown in the picker
//   ico     — emoji
//   desc    — one-line description
//   mods    — module keys this sector reveals (matched against MENU item `mod`)
//   allMods — when true, every mod-gated item shows (used by the general sector)
//   relabel — { [route]: 'اسم مخصّص' } overrides for generic menu items
//
// Menu items carry a `mod` for these specialized sections (see Layout.jsx MENU):
//   production   → التصنيع            repair → الصيانة/أوامر العمل
//   installments → الأقساط والديون    assets → الأصول الثابتة
//   projects     → المشاريع           crm    → العملاء المحتملون
//   wholesale    → قوائم الأسعار      reps   → المندوبون
//   delivery     → التوصيل
// Core sections (بيع، مخزون، عملاء، موردين، مصروفات، محاسبة، تقارير، إعدادات…)
// have NO `mod`, so they always show regardless of sector.

export const SECTORS = [
  {
    id: 'general', name: 'عام / أي نشاط', ico: '🏬',
    desc: 'إعداد قياسي يعرض كل الأقسام — يصلح لأي محل أو نشاط.',
    allMods: true, mods: [], relabel: {},
  },
  {
    id: 'mobile', name: 'موبايلات وقطع غيار', ico: '📱',
    desc: 'صيانة وبيع موبايلات وإكسسوارات — يظهر الصيانة والأقساط.',
    mods: ['repair', 'installments'],
    relabel: { '/items': 'قطع الغيار', '/maintenance': 'صيانة الأجهزة' },
    fields: {
      item: [
        { key: 'model', label: 'الموديل المتوافق', type: 'text' },
        { key: 'color', label: 'اللون', type: 'text' },
        { key: 'quality', label: 'الجودة (أصلي/تجاري)', type: 'text' },
      ],
    },
  },
  {
    id: 'factory', name: 'مصنع / تصنيع', ico: '🏭',
    desc: 'تحويل مواد خام لمنتجات — يظهر التصنيع والأصول والمشاريع.',
    mods: ['production', 'assets', 'projects'],
    relabel: { '/items': 'المواد والمنتجات', '/employees': 'العمال', '/expenses': 'تكاليف التشغيل' },
    fields: {
      item: [
        { key: 'unit', label: 'وحدة القياس', type: 'text' },
        { key: 'matCode', label: 'كود المادة', type: 'text' },
      ],
    },
  },
  {
    id: 'contracting', name: 'مقاولات', ico: '🏗️',
    desc: 'إدارة المشاريع والخامات والعمالة والأصول والعملاء المحتملين.',
    mods: ['projects', 'assets', 'crm'],
    relabel: { '/items': 'الخامات', '/employees': 'العمالة', '/expenses': 'مصاريف المشروع', '/projects': 'المشاريع والعقود' },
    fields: {
      item: [
        { key: 'unit', label: 'وحدة القياس (م/م²/طن)', type: 'text' },
        { key: 'origin', label: 'المصدر/المصنع', type: 'text' },
      ],
      customer: [
        { key: 'projName', label: 'اسم المشروع', type: 'text' },
        { key: 'projLoc', label: 'موقع المشروع', type: 'text' },
      ],
    },
  },
  {
    id: 'restaurant', name: 'مطعم / كافيه', ico: '🍽️',
    desc: 'مكوّنات وأصناف جاهزة (تصنيع) مع خدمة التوصيل.',
    mods: ['production', 'delivery'],
    relabel: { '/items': 'الأصناف والمكوّنات', '/expenses': 'مصاريف التشغيل' },
    fields: {
      item: [
        { key: 'unit', label: 'وحدة التقديم (طبق/كوب/كجم)', type: 'text' },
        { key: 'kind', label: 'النوع (صنف جاهز/مكوّن)', type: 'text' },
      ],
    },
  },
  {
    id: 'pharmacy', name: 'صيدلية', ico: '💊',
    desc: 'بيع أدوية ومستلزمات بأكواد وباركود وتتبّع صلاحية — بدون أقسام صناعية.',
    mods: [],
    relabel: { '/items': 'الأدوية والمنتجات', '/inventory-ops': 'الجرد والصلاحية' },
    fields: {
      item: [
        { key: 'expiry', label: 'تاريخ الصلاحية', type: 'date' },
        { key: 'batch', label: 'رقم التشغيلة', type: 'text' },
        { key: 'active', label: 'المادة الفعّالة', type: 'text' },
        { key: 'maker', label: 'الشركة المصنّعة', type: 'text' },
      ],
    },
  },
  {
    id: 'clothes', name: 'ملابس وأحذية', ico: '👕',
    desc: 'بيع تجزئة بمقاسات وألوان مع بيع بالتقسيط.',
    mods: ['installments'],
    relabel: { '/items': 'المنتجات' },
    fields: {
      item: [
        { key: 'size', label: 'المقاس', type: 'text' },
        { key: 'color', label: 'اللون', type: 'text' },
        { key: 'material', label: 'الخامة', type: 'text' },
      ],
    },
  },
  {
    id: 'wholesale', name: 'تجارة جملة', ico: '📦',
    desc: 'بيع بالجملة — قوائم أسعار ومندوبون وعملاء محتملون وأقساط.',
    mods: ['wholesale', 'reps', 'crm', 'installments'],
    relabel: {},
    fields: {
      item: [
        { key: 'pkgUnit', label: 'وحدة الجملة (كرتونة/شوال)', type: 'text' },
        { key: 'pkgQty', label: 'العدد داخل العبوة', type: 'number' },
      ],
    },
  },
  {
    id: 'services', name: 'خدمات وصيانة', ico: '🔧',
    desc: 'ورش وخدمات — أوامر صيانة ومشاريع وعملاء محتملون.',
    mods: ['repair', 'projects', 'crm'],
    relabel: { '/items': 'قطع الغيار', '/expenses': 'مصاريف التشغيل', '/maintenance': 'أوامر الصيانة' },
    fields: {
      item: [
        { key: 'svcType', label: 'نوع الخدمة/القطعة', type: 'text' },
        { key: 'warranty', label: 'مدة الضمان', type: 'text' },
      ],
    },
  },
];

export const getSector = (id) => SECTORS.find((s) => s.id === id) || SECTORS[0];

// Build the sector's default custom-field definitions (its "requirements"),
// tagged origin:'sector' so they can be swapped when the sector changes while
// user-added fields are preserved. Stable ids keep saved values across reseeds.
export function sectorFieldDefs(id) {
  const f = (getSector(id).fields) || {};
  const out = [];
  for (const entity of ['item', 'customer', 'supplier']) {
    for (const def of (f[entity] || [])) {
      out.push({ id: `sec_${id}_${entity}_${def.key}`, entity, label: def.label, type: def.type || 'text', origin: 'sector' });
    }
  }
  return out;
}
