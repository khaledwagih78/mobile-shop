// ---------- business sectors (المجال / النشاط) ----------
// Choosing a sector tailors the app: it reveals sector-specific modules that
// stay HIDDEN otherwise (via a menu item's `mod` key), and relabels a few
// generic screens with names that fit the trade. Everything is config-driven —
// no feature is deleted, so switching sector never loses data.
//
// Each sector:
//   id      — stored in settings under `bizSector`
//   name    — Arabic label shown in the picker
//   ico     — emoji
//   desc    — one-line description
//   mods    — module keys this sector reveals (matched against MENU item `mod`)
//   relabel — { [route]: 'اسم مخصّص' } overrides for generic menu items

export const SECTORS = [
  {
    id: 'general', name: 'عام / أي نشاط', ico: '🏬',
    desc: 'إعداد قياسي يصلح لأي محل أو نشاط تجاري.',
    mods: [], relabel: {},
  },
  {
    id: 'mobile', name: 'موبايلات وقطع غيار', ico: '📱',
    desc: 'محل صيانة وبيع موبايلات وإكسسوارات وقطع غيار.',
    mods: [], relabel: { '/items': 'قطع الغيار' },
  },
  {
    id: 'factory', name: 'مصنع / تصنيع', ico: '🏭',
    desc: 'تحويل مواد خام لمنتجات نهائية — يظهر التصنيع والعمال وتكاليف التشغيل.',
    mods: ['production'],
    relabel: { '/items': 'المواد والمنتجات', '/employees': 'العمال', '/expenses': 'تكاليف التشغيل' },
  },
  {
    id: 'contracting', name: 'مقاولات', ico: '🏗️',
    desc: 'إدارة الخامات والعمالة ومصاريف المشاريع.',
    mods: [],
    relabel: { '/items': 'الخامات', '/employees': 'العمالة', '/expenses': 'مصاريف المشروع' },
  },
  {
    id: 'restaurant', name: 'مطعم / كافيه', ico: '🍽️',
    desc: 'أصناف ومكوّنات مع تحويل المكوّنات لأصناف جاهزة (التصنيع).',
    mods: ['production'],
    relabel: { '/items': 'الأصناف والمكوّنات', '/expenses': 'مصاريف التشغيل' },
  },
  {
    id: 'pharmacy', name: 'صيدلية', ico: '💊',
    desc: 'بيع أدوية ومستلزمات طبية بأكواد وباركود.',
    mods: [], relabel: { '/items': 'الأدوية والمنتجات' },
  },
  {
    id: 'clothes', name: 'ملابس وأحذية', ico: '👕',
    desc: 'بيع تجزئة للملابس والأحذية بمقاسات وألوان.',
    mods: [], relabel: { '/items': 'المنتجات' },
  },
  {
    id: 'wholesale', name: 'تجارة جملة', ico: '📦',
    desc: 'بيع بالجملة مع أسعار جملة وكميات كبيرة.',
    mods: [], relabel: {},
  },
  {
    id: 'services', name: 'خدمات وصيانة', ico: '🔧',
    desc: 'ورش وخدمات صيانة مع قطع غيار ومصاريف تشغيل.',
    mods: [], relabel: { '/items': 'قطع الغيار', '/expenses': 'مصاريف التشغيل' },
  },
];

export const getSector = (id) => SECTORS.find((s) => s.id === id) || SECTORS[0];
