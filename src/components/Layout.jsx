import { NavLink, Outlet } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSetting, stockOf } from '../db';
import { useAuth } from '../auth';
import { can, ROLES } from '../utils';
import { useSyncStatus } from '../sync';
import { getSector } from '../sectors';

function relTime(iso) {
  if (!iso) return null;
  const m = Math.floor((Date.now() - new Date(iso)) / 60_000);
  if (m < 1) return 'الآن';
  if (m < 60) return `${m}د`;
  return `${Math.floor(m / 60)}س`;
}

const SYNC_ICO = { syncing: '⏳', ok: '☁️', error: '⚠️', offline: '📵', idle: '☁️' };

const MENU = [
  { to: '/', ico: '📊', label: 'الرئيسية', action: null },
  { to: '/insights', ico: '🤖', label: 'المساعد الذكي', action: 'insights' },
  { to: '/voice', ico: '🎤', label: 'تحليل بالصوت', action: 'voice' },
  { to: '/pos', ico: '🧾', label: 'بيع جديد', action: 'pos' },
  { to: '/quote', ico: '📄', label: 'عرض سعر', action: 'quote' },
  { to: '/purchase', ico: '📥', label: 'فاتورة شراء', action: 'purchase' },
  { to: '/purchase-order', ico: '📝', label: 'طلب شراء', action: 'purchase' },
  { to: '/sale-return', ico: '↩️', label: 'مرتجع بيع', action: 'returns' },
  { to: '/purchase-return', ico: '↪️', label: 'مرتجع شراء', action: 'returns' },
  { to: '/invoices', ico: '🗂️', label: 'الفواتير', action: 'invoices' },
  { to: '/items', ico: '📦', label: 'المخزون', action: 'items' },
  { to: '/pricing', ico: '🏷️', label: 'قوائم الأسعار', action: 'pricing' },
  { to: '/production', ico: '🏭', label: 'التصنيع', action: 'production', mod: 'production' },
  { to: '/inventory-ops', ico: '📋', label: 'الجرد والتسويات', action: 'invops' },
  { to: '/transfer', ico: '🔄', label: 'تحويل بضاعة', action: 'transfer' },
  { to: '/crm', ico: '🤝', label: 'العملاء المحتملون', action: 'crm' },
  { to: '/customers', ico: '👥', label: 'العملاء', action: 'customers' },
  { to: '/suppliers', ico: '🚚', label: 'الموردين', action: 'suppliers' },
  { to: '/deliveries', ico: '🚗', label: 'التوصيل', action: 'pos' },
  { to: '/reps', ico: '🚶', label: 'المندوبون', action: 'reps' },
  { to: '/expenses',   ico: '💸', label: 'المصروفات',  action: 'expenses'   },
  { to: '/employees',  ico: '👷', label: 'الموظفين',   action: 'employees'  },
  { to: '/payroll',    ico: '💵', label: 'الرواتب',    action: 'payroll'    },
  { to: '/accounting', ico: '📒', label: 'المحاسبة', action: 'accounting' },
  { to: '/treasury', ico: '🏦', label: 'الخزائن والبنوك', action: 'treasury' },
  { to: '/assets', ico: '🏛️', label: 'الأصول الثابتة', action: 'assets' },
  { to: '/installments', ico: '💳', label: 'الأقساط والديون', action: 'installments' },
  { to: '/projects', ico: '📁', label: 'المشاريع', action: 'projects' },
  { to: '/maintenance', ico: '🔧', label: 'الصيانة', action: 'maintenance' },
  { to: '/reports', ico: '📈', label: 'التقارير', action: 'reports' },
  { to: '/audit', ico: '📋', label: 'سجل النشاطات', action: 'reports' },
  { to: '/import', ico: '📑', label: 'استيراد Excel', action: 'import' },
  { to: '/backup', ico: '🛡️', label: 'النسخ الاحتياطي', action: 'backup' },
  { to: '/branches', ico: '🏢', label: 'الفروع', action: 'branches' },
  { to: '/users', ico: '🔑', label: 'المستخدمين', action: 'users' },
  { to: '/sector', ico: '🧭', label: 'مجال النشاط', action: 'sector' },
  { to: '/settings', ico: '⚙️', label: 'الإعدادات', action: 'settings' },
  { to: '/custom-fields', ico: '🧩', label: 'الحقول المخصّصة', action: 'settings' },
  { to: '/requests', ico: '📝', label: 'الطلبات والاقتراحات', action: 'requests' },
];

const MOBILE = ['/', '/pos', '/items', '/customers', '/invoices'];

export default function Layout() {
  const { user, logout, branches, activeBranch, setActiveBranch } = useAuth();
  const syncStatus = useSyncStatus();
  const pending    = useLiveQuery(() => db.syncQueue.where('synced').equals(0).count(), [], 0);
  const bizName = useLiveQuery(() => getSetting('bizName', 'نظام المبيعات والمخزون'), [], 'نظام المبيعات والمخزون');
  const sectorId = useLiveQuery(() => getSetting('bizSector', 'general'), [], 'general');
  const sector = getSector(sectorId);
  const lowStockCount = useLiveQuery(async () => {
    const items = await db.items.toArray();
    return items.filter((it) => stockOf(it, activeBranch) > 0 && stockOf(it, activeBranch) <= (it.minStock || 0)).length;
  }, [activeBranch], 0);
  const visible = MENU
    // permission + sector gating: items with a `mod` show only when the chosen sector reveals it
    .filter((m) => (!m.action || can(user.role, m.action)) && (!m.mod || (sector.mods || []).includes(m.mod)))
    // apply sector-specific labels (e.g. المخزون -> "المواد والمنتجات")
    .map((m) => (sector.relabel && sector.relabel[m.to]) ? { ...m, label: sector.relabel[m.to] } : m);
  const mobileItems = visible.filter((m) => MOBILE.includes(m.to)).slice(0, 5);
  const isAdmin = user.role === 'admin';
  const curBranch = branches.find((b) => b.id === activeBranch);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          {bizName}
          <small>نظام المبيعات والمخزون</small>
        </div>

        <div className="branch-switch" style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,.12)' }}>
          <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>🏢 الفرع الحالي</div>
          {isAdmin && branches.length > 1 ? (
            <select
              className="input"
              value={activeBranch}
              onChange={(e) => setActiveBranch(Number(e.target.value))}
              style={{ width: '100%', padding: '6px 8px', fontSize: 13 }}
            >
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          ) : (
            <b style={{ fontSize: 14 }}>{curBranch ? curBranch.name : 'الفرع الرئيسي'}</b>
          )}
        </div>

        <nav className="nav">
          {visible.map((m) => (
            <NavLink key={m.to} to={m.to} end={m.to === '/'}>
              <span className="ico">{m.ico}</span> {m.label}
              {m.to === '/items' && lowStockCount > 0 && (
                <span className="badge red" style={{ marginLeft: 6, fontSize: 10, padding: '2px 6px' }}>{lowStockCount}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-user">
          <b>{user.name}</b>
          <span style={{ opacity: 0.75 }}>{ROLES[user.role]}</span>
          <div style={{ fontSize: 11, marginTop: 4, opacity: 0.75 }}>
            {SYNC_ICO[syncStatus.state] || '☁️'}{' '}
            {syncStatus.state === 'syncing' && 'جاري المزامنة...'}
            {syncStatus.state === 'ok'      && `مزامن ${relTime(syncStatus.at) || ''}`}
            {syncStatus.state === 'error'   && 'خطأ في المزامنة'}
            {syncStatus.state === 'offline' && 'بدون إنترنت'}
            {syncStatus.state === 'idle'    && 'Supabase'}
            {pending > 0 && syncStatus.state !== 'syncing' && ` · ${pending} معلّق`}
          </div>
          <button onClick={logout}>تسجيل الخروج</button>
        </div>
      </aside>

      <main className="main">
        <Outlet />
      </main>

      <nav className="bottom-nav">
        {mobileItems.map((m) => (
          <NavLink key={m.to} to={m.to} end={m.to === '/'}>
            <span className="ico">{m.ico}</span>
            {m.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
